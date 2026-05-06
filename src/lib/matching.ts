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
  assignedHours: number; // dynamically computed
}

// Rank candidates based on Priority Logic
export function rankCandidates(
  request: Request,
  requestingSchool: School,
  allTeachers: (Teacher & { assignments: { hours: number }[] })[]
): TeacherWithDistance[] {
  
  const eligibleTeachers: TeacherWithDistance[] = []

  for (const teacher of allTeachers) {
    // b) Hard Filter: Sick/Leave status
    if (teacher.status !== 'ACTIVE') continue

    // Calculate current weekly hours (simplified: sum of all assignments in this mockup)
    const currentHours = teacher.assignments.reduce((sum, a) => sum + a.hours, 0)
    
    // Check Max Weekly Hours - Allow if they have ANY capacity left for partial matching
    if (currentHours >= teacher.maxWeeklyHours) continue

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

    // Add inverse distance as a tie-breaker (closer = higher score)
    score += 100 / (1 + distance)

    eligibleTeachers.push({
      ...teacher,
      distanceToSchool: distance,
      matchScore: score,
      assignedHours: currentHours
    })
  }

  // Sort by highest score first
  return eligibleTeachers.sort((a, b) => b.matchScore - a.matchScore)
}
