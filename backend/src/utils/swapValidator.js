const prisma = require('../lib/prisma');

// Returns { ok, warnings } — warnings are blockers if `ok` false, advisories otherwise.
async function validateSwap(fromDuty, toDutyOrStaffId, branch) {
  const warnings = [];
  let ok = true;

  // Resolve receiver duty / receiver staff
  const receiverDuty = typeof toDutyOrStaffId === 'object' ? toDutyOrStaffId : null;
  const receiverStaffId = receiverDuty ? receiverDuty.staff_id : toDutyOrStaffId;

  // Same branch check
  const requesterStaff = await prisma.staff.findUnique({ where: { id: fromDuty.staff_id } });
  const receiverStaff = await prisma.staff.findUnique({ where: { id: receiverStaffId } });
  if (!receiverStaff || receiverStaff.branch_id !== requesterStaff.branch_id) {
    ok = false; warnings.push('Cross-branch swap not allowed');
  }

  // Eligibility for shift
  const shift = await prisma.shiftType.findUnique({ where: { id: fromDuty.shift_type_id } });
  if (receiverStaff.eligible_shift_ids.length && !receiverStaff.eligible_shift_ids.includes(shift.id)) {
    warnings.push(`${receiverStaff.full_name} is not eligible for ${shift.name}`);
  }
  if (shift.eligible_designations.length && receiverStaff.designation && !shift.eligible_designations.includes(receiverStaff.designation)) {
    warnings.push(`Designation ${receiverStaff.designation} not allowed on ${shift.name}`);
  }

  // Already on duty that day?
  const sameDay = await prisma.duty.findFirst({
    where: {
      staff_id: receiverStaffId,
      date: fromDuty.date,
      id: { not: receiverDuty?.id },
    },
  });
  if (sameDay) warnings.push('Receiver already has a duty that day');

  // Weekly hours/shifts
  const weekStart = new Date(fromDuty.date);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7)); // Monday
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const weekDuties = await prisma.duty.findMany({
    where: { staff_id: receiverStaffId, date: { gte: weekStart, lt: weekEnd } },
    include: { shift_type: true },
  });
  const totalHrs = weekDuties.reduce((sum, d) => {
    const st = d.shift_type;
    let s = new Date(`2000-01-01T${st.start_time}`); let e = new Date(`2000-01-01T${st.end_time}`);
    if (e <= s) e.setDate(e.getDate() + 1);
    return sum + Math.max(0, (e - s) / 3600000 - (st.break_minutes || 0) / 60);
  }, 0);
  let addHrs = 0;
  {
    const st = shift;
    let s = new Date(`2000-01-01T${st.start_time}`); let e = new Date(`2000-01-01T${st.end_time}`);
    if (e <= s) e.setDate(e.getDate() + 1);
    addHrs = Math.max(0, (e - s) / 3600000 - (st.break_minutes || 0) / 60);
  }
  const cap = Math.min(branch.max_hours_per_week, receiverStaff.weekly_hour_limit);
  if (totalHrs + addHrs > cap) { ok = false; warnings.push(`Would exceed weekly hour cap (${cap}h)`); }
  if (weekDuties.length + 1 > branch.max_shifts_per_week) {
    ok = false; warnings.push(`Would exceed max ${branch.max_shifts_per_week} shifts/week`);
  }

  // Rest hours
  const adjacent = await prisma.duty.findMany({
    where: {
      staff_id: receiverStaffId,
      OR: [
        { end_at: { gt: new Date(fromDuty.start_at.getTime() - branch.min_rest_hours * 3600000), lte: fromDuty.start_at } },
        { start_at: { gte: fromDuty.end_at, lt: new Date(fromDuty.end_at.getTime() + branch.min_rest_hours * 3600000) } },
      ],
    },
  });
  if (adjacent.length) { ok = false; warnings.push(`Less than ${branch.min_rest_hours}h rest between shifts`); }

  return { ok, warnings };
}

module.exports = { validateSwap };
