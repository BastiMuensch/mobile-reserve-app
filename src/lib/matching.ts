import { Teacher, School, Request } from '@prisma/client'

// Earth radius in kilometers
const R = 6371

// Haversine formula to calculate distance between two lat/lng coordinates in km
export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * (Math.PI / 180)
  const dLon = (lon2 - lon1) * (Math.PI / 180)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

export type TeacherWithDistance = Teacher & {
  distanceToSchool: number;
  matchScore: number;
  assignedHours: number;
  isOvertime?: boolean;
}

// Rank candidates based on Priority Logic
export function rankCandidates(
  request: Request,
  requestingSchool: School,
  allTeachers: (Teacher & { assignments: { hours: number; date: Date }[] })[]
): TeacherWithDistance[] {
  
  const eligibleTeachers: TeacherWithDistance[] = []

  // Calculate current week boundaries (Monday to Sunday)
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay() + 1); // Monday
  weekStart.setHours(0,0,0,0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23,59,59,999);

  for (const teacher of allTeachers) {
    // b) Hard Filter: Sick/Leave status
    if (teacher.status !== 'ACTIVE') continue

    // Calculate current weekly hours (filtered to current week only)
    const currentHours = teacher.assignments
      .filter(a => { const d = new Date(a.date); return d >= weekStart && d <= weekEnd; })
      .reduce((sum, a) => sum + a.hours, 0)
    
    // Check Max Weekly Hours - Mark as overtime if exceeded
    const isOvertime = currentHours >= teacher.maxWeeklyHours;

    // d) Check Part-Time Schedule Match
    if (teacher.isPartTime && teacher.schedule) {
      try {
        const schedule = JSON.parse(teacher.schedule);
        const reqStart = new Date(request.date);
        const reqEnd = request.endDate ? new Date(request.endDate) : reqStart;
        
        let isAvailable = true;
        const reqSchedule = request.schedule ? JSON.parse(request.schedule) : null;

        // Loop through each day in the requested period
        for (let d = new Date(reqStart); d <= reqEnd; d.setDate(d.getDate() + 1)) {
          const dayOfWeek = d.getDay() === 0 ? 7 : d.getDay(); // 1=Mon, 7=Sun
          if (dayOfWeek > 5) continue; // Skip weekends
          
          // The required hours for each day
          let requiredHours: number[] = [];
          if (reqSchedule) {
            requiredHours = reqSchedule[dayOfWeek.toString()] || [];
          } else {
            requiredHours = Array.from({ length: request.hours }, (_, i) => request.startHour + i);
          }
          
          // If no hours required on this day, skip check
          if (requiredHours.length === 0) continue;
          
          // Check if teacher schedule has all required hours for this dayOfWeek
          const teacherDaySchedule = schedule[dayOfWeek.toString()] || [];
          const hasHours = requiredHours.every(h => teacherDaySchedule.includes(h));
          
          if (!hasHours) {
            isAvailable = false;
            break;
          }
        }
        
        if (!isAvailable) continue;
      } catch (e) {
        console.error("Invalid schedule JSON for teacher", teacher.id);
        continue;
      }
    }

    // c) Qualifications Match (Soft Filter)
    const reqQuals = request.qualifications.split(',').filter(Boolean)
    const teacherQuals = teacher.qualifications.split(',').filter(Boolean)
    
    // If teacher has "Alles", they perfectly match any qualification.
    const hasAllQuals = teacherQuals.includes('Alles') || 
      (reqQuals.length === 0) || 
      reqQuals.every(q => teacherQuals.includes(q));

    const distance = calculateDistance(requestingSchool.latitude, requestingSchool.longitude, teacher.homeLat, teacher.homeLng)

    let score = 0
    // a) Priority 1: Stammschule
    if (teacher.stammschuleId === requestingSchool.id) {
      score += 1000 // Huge boost for Stammschule
    }
    
    // b) Priority 2: Qualifications Match
    if (hasAllQuals) {
      score += 500 // Significant boost for having the exact requested qualification or 'Alles'
    }

    // preferredType scoring
    if (teacher.preferredType) {
      if (teacher.preferredType === request.schoolType) {
        score += 15;
      } else if (teacher.preferredType !== 'BOTH') {
        score -= 10;
      }
    }

    // Add inverse distance as a tie-breaker (closer = higher score)
    score += 100 / (1 + distance)

    if (isOvertime) {
      score -= 5000; // Penalize overtime heavily so they appear at the bottom
    }

    eligibleTeachers.push({
      ...teacher,
      distanceToSchool: distance,
      matchScore: score,
      assignedHours: currentHours,
      isOvertime
    })
  }

  // Sort by highest score first
  return eligibleTeachers.sort((a, b) => b.matchScore - a.matchScore)
}
