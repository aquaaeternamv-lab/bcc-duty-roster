// Greedy fair-share weekly roster generator.
// Inputs: branch (with rules), shiftTypes, staff, leaves, weekStart (Date Monday)
// Output: array of duty objects { staff_id, shift_type_id, date, start_at, end_at, is_night }

function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function dayOfWeek(d) { return d.getDay(); } // 0=Sun..6=Sat
function combineDateTime(date, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const x = new Date(date);
  x.setHours(h, m, 0, 0);
  return x;
}
function shiftHours(st) {
  const start = combineDateTime(new Date('2000-01-01'), st.start_time);
  let end = combineDateTime(new Date('2000-01-01'), st.end_time);
  if (end <= start) end = addDays(end, 1); // overnight
  const ms = end - start;
  return Math.max(0, ms / 3600000 - (st.break_minutes || 0) / 60);
}

function isOnLeave(staffId, date, leaves) {
  const d = date.getTime();
  return leaves.some((l) => l.staff_id === staffId
    && l.status === 'approved'
    && new Date(l.from_date).getTime() <= d
    && new Date(l.to_date).getTime() >= d);
}

function generateRoster({ branch, shiftTypes, staff, leaves, weekStart }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const duties = [];

  // tracking per-staff weekly load
  const weekHours = {};
  const weekShifts = {};
  const lastEnd = {};      // staff_id -> Date of last shift end (for rest hours)
  const dayAssigned = {};  // `${staff_id}_${dayKey}` flag
  staff.forEach((s) => { weekHours[s.id] = 0; weekShifts[s.id] = 0; });

  const operatingDays = branch.operating_days?.length ? branch.operating_days : [0,1,2,3,4,5,6];

  for (const date of days) {
    const dow = dayOfWeek(date);
    if (!operatingDays.includes(dow)) continue;
    if (branch.fixed_off_day === dow) continue;

    // shifts active for this branch
    for (const st of shiftTypes.filter((s) => s.active && s.branch_id === branch.id)) {
      const startAt = combineDateTime(date, st.start_time);
      let endAt = combineDateTime(date, st.end_time);
      if (endAt <= startAt) endAt = addDays(endAt, 1);
      const hours = shiftHours(st);

      // candidate pool
      const pool = staff.filter((s) => {
        if (!s.active) return false;
        if (s.branch_id !== branch.id) return false;
        if (s.eligible_shift_ids.length && !s.eligible_shift_ids.includes(st.id)) return false;
        if (st.eligible_designations.length && s.designation && !st.eligible_designations.includes(s.designation)) return false;
        if (s.unavailable_days?.includes(dow)) return false;
        if (isOnLeave(s.id, date, leaves)) return false;
        const dayKey = `${s.id}_${date.toISOString().slice(0,10)}`;
        if (dayAssigned[dayKey]) return false;
        if (weekShifts[s.id] >= branch.max_shifts_per_week) return false;
        if (weekHours[s.id] + hours > Math.min(branch.max_hours_per_week, s.weekly_hour_limit)) return false;
        if (lastEnd[s.id]) {
          const restHrs = (startAt - lastEnd[s.id]) / 3600000;
          if (restHrs < branch.min_rest_hours) return false;
        }
        return true;
      });

      // sort by least-loaded first (fairness), tiebreak random
      pool.sort((a, b) => (weekHours[a.id] - weekHours[b.id]) || Math.random() - 0.5);

      const need = st.required_staff || 1;
      const picks = pool.slice(0, need);

      for (const s of picks) {
        duties.push({
          staff_id: s.id,
          shift_type_id: st.id,
          date,
          start_at: startAt,
          end_at: endAt,
          is_night: !!st.is_night,
        });
        weekHours[s.id] += hours;
        weekShifts[s.id] += 1;
        lastEnd[s.id] = endAt;
        dayAssigned[`${s.id}_${date.toISOString().slice(0,10)}`] = true;
      }
    }
  }

  return duties;
}

module.exports = { generateRoster, shiftHours };
