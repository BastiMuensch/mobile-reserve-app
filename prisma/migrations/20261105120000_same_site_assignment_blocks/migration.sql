-- A reserve remains bound to one school site for the day. Distinct requests
-- may share that day only when both immutable lesson snapshots prove separation.
-- No extension or additional database privileges are needed.

CREATE FUNCTION assignment_booking_slots(snapshot TEXT, hours INTEGER)
RETURNS INTEGER[] LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  parsed JSONB;
  slots INTEGER[];
BEGIN
  IF snapshot IS NULL OR hours <= 0 THEN RETURN NULL; END IF;
  parsed := snapshot::jsonb;
  IF jsonb_typeof(parsed) <> 'array' OR jsonb_array_length(parsed) <> hours THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(parsed) AS item
    WHERE jsonb_typeof(item) <> 'number' OR item::text !~ '^[0-9]+$'
      OR (item::text)::numeric < 1 OR (item::text)::numeric > 10) THEN RETURN NULL; END IF;
  SELECT array_agg(value::integer ORDER BY value::integer) INTO slots FROM jsonb_array_elements_text(parsed);
  IF (SELECT count(DISTINCT value) FROM unnest(slots) AS value) <> hours THEN RETURN NULL; END IF;
  RETURN slots;
EXCEPTION WHEN OTHERS THEN
  -- Invalid legacy/imported snapshots conservatively occupy the whole day.
  RETURN NULL;
END;
$$;

CREATE FUNCTION enforce_assignment_day_booking()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  destination "Request"%ROWTYPE;
  new_slots INTEGER[];
BEGIN
  IF NEW."status" IN ('REJECTED', 'CANCELLED') THEN RETURN NEW; END IF;

  -- Updating the teacher row serializes competing writes even when no assignment
  -- yet exists. Unlike an advisory lock alone, this also changes the row version:
  -- a Repeatable Read/Serializable transaction with a stale snapshot must retry.
  -- At Read Committed the subsequent volatile-function query gets a fresh snapshot.
  UPDATE "Teacher" SET "id" = "id" WHERE "id" = NEW."teacherId";
  SELECT * INTO destination FROM "Request" WHERE "id" = NEW."requestId";
  IF destination."status" = 'CANCELLED' THEN RETURN NEW; END IF;
  new_slots := assignment_booking_slots(NEW."lessonHours", NEW."hours");

  IF EXISTS (
    SELECT 1 FROM "Assignment" AS other
    JOIN "Request" AS parent ON parent."id" = other."requestId"
    WHERE other."teacherId" = NEW."teacherId" AND other."date" = NEW."date"
      AND other."id" <> NEW."id"
      AND other."status" NOT IN ('REJECTED', 'CANCELLED') AND parent."status" <> 'CANCELLED'
      AND (
        other."requestId" = NEW."requestId"
        OR parent."schoolId" IS DISTINCT FROM destination."schoolId"
        OR parent."locationId" IS DISTINCT FROM destination."locationId"
        OR new_slots IS NULL
        OR assignment_booking_slots(other."lessonHours", other."hours") IS NULL
        OR new_slots && assignment_booking_slots(other."lessonHours", other."hours")
      )
  ) THEN
    RAISE EXCEPTION 'The reserve is already assigned to incompatible lessons or another school site on this day.'
      USING ERRCODE = '23505', CONSTRAINT = 'Assignment_teacher_day_booking_conflict';
  END IF;
  RETURN NEW;
END;
$$;

DROP INDEX "Assignment_teacher_active_date_unique";
CREATE UNIQUE INDEX "Assignment_teacher_request_active_date_unique"
  ON "Assignment" ("teacherId", "requestId", "date")
  WHERE "status" NOT IN ('REJECTED', 'CANCELLED');

CREATE TRIGGER "Assignment_check_day_booking"
  BEFORE INSERT OR UPDATE OF "teacherId", "requestId", "date", "hours", "lessonHours", "status"
  ON "Assignment" FOR EACH ROW EXECUTE FUNCTION enforce_assignment_day_booking();

-- Restore/import, reactivation and a request's site change must obey the same
-- invariant, including writes outside the normal assignment service.
CREATE FUNCTION recheck_request_day_bookings()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "Assignment" SET "status" = "status"
    WHERE "requestId" = NEW."id" AND "status" NOT IN ('REJECTED', 'CANCELLED');
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Request_recheck_day_bookings"
  AFTER UPDATE OF "schoolId", "locationId", "status" ON "Request"
  FOR EACH ROW WHEN (
    OLD."schoolId" IS DISTINCT FROM NEW."schoolId"
    OR OLD."locationId" IS DISTINCT FROM NEW."locationId"
    OR (OLD."status" = 'CANCELLED') IS DISTINCT FROM (NEW."status" = 'CANCELLED')
  ) EXECUTE FUNCTION recheck_request_day_bookings();
