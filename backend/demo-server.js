/* ============================================================
   BCC Duty & Roster — DEMO SERVER (in-memory, no database)
   ============================================================
   Same API surface as the real server but everything lives in
   RAM. Restart = fresh seed. Perfect for management demos.

   Run:   node demo-server.js
   Open:  http://localhost:4001
   Login: admin@bcc.local / ChangeMe123!
============================================================ */
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

/* ---------------- In-memory store ---------------- */
const db = {
  branches: [], shiftTypes: [], staff: [], users: [],
  rosters: [], duties: [], swaps: [], leaves: [],
  attendance: [], notifications: [], audit: [], tokens: {},
};

/* ---------------- Seed ---------------- */
function seed() {
  const seedBranch = (name, slug, opts = {}) => {
    const b = {
      id: uid(), name, slug, location: 'Maldives',
      operating_days: opts.operating_days || [0,1,2,3,4,5,6],
      open_time: opts.open_time || '09:00', close_time: opts.close_time || '22:00',
      active: true, max_hours_per_day: opts.max_hours_per_day || 10,
      max_hours_per_week: 48, max_shifts_per_week: 6,
      min_rest_hours: 10, weekend_days: [5,6], fixed_off_day: opts.fixed_off_day ?? null,
      overtime_after_hrs: 8, night_shift_start: null, night_shift_end: null,
      notify_email: null, notify_whatsapp: null,
      logo: opts.logo || null, accent: opts.accent || null,
      created_at: now(), updated_at: now(),
    };
    db.branches.push(b); return b;
  };

  // SEED — closed Fridays (operating_days excludes 5=Fri); 3 actual shift bands
  const seed = seedBranch('SEED', 'seed', {
    open_time: '08:00', close_time: '22:00',
    operating_days: [0,1,2,3,4,6], fixed_off_day: 5,
    logo: '/assets/seed-logo.svg', accent: '#6286a6',
  });
  const am = seedBranch('Authentic Maldives', 'authentic-maldives', {
    open_time: '09:00', close_time: '22:00',
    logo: '/assets/am-logo.svg', accent: '#114b81',
  });
  const ch = seedBranch('Creator Hub', 'creator-hub', {
    open_time: '09:00', close_time: '21:00',
    accent: '#1f74c4',
  });

  const seedShift = (branch, name, start, end, required = 2, isNight = false, breakMin = 30) => {
    const s = { id: uid(), branch_id: branch.id, name, start_time: start, end_time: end,
      break_minutes: breakMin, required_staff: required, eligible_designations: [],
      is_night: isNight, active: true, created_at: now() };
    db.shiftTypes.push(s); return s;
  };

  // SEED — real shift bands from operating roster
  seedShift(seed, 'Morning',  '08:00', '16:00', 2, false, 30);
  seedShift(seed, 'Floater',  '11:00', '19:00', 0, false, 30); // optional cover slot
  seedShift(seed, 'Evening',  '14:00', '22:00', 2, false, 30);

  // AM + CH keep generic shifts (will replace when real schedules provided)
  [am, ch].forEach(b => {
    seedShift(b, 'Morning', '08:00', '14:00', 2);
    seedShift(b, 'Evening', '14:00', '22:00', 2);
    seedShift(b, 'Full Day', '09:00', '18:00', 1);
  });

  // Super admin
  db.users.push({
    id: uid(), email: 'admin@bcc.local', name: 'Super Admin', role: 'super_admin',
    branch_id: null, staff_id: null, active: true, password: 'bcc2026', created_at: now(),
  });

  // Branch managers + staff
  const seedPeople = (branch, managerName, staffNames) => {
    const mgrUser = {
      id: uid(), email: `${branch.slug}-manager@bcc.local`, name: managerName,
      role: 'branch_manager', branch_id: branch.id, staff_id: null, active: true,
      password: 'bcc2026', created_at: now(),
    };
    db.users.push(mgrUser);

    staffNames.forEach((nm, i) => {
      const staff = {
        id: uid(), employee_id: `${branch.slug.toUpperCase().slice(0,3)}-${String(i+1).padStart(3,'0')}`,
        branch_id: branch.id, full_name: nm,
        designation: ['Server','Chef','Host','Bartender','Receptionist'][i % 5],
        employment_type: 'full_time',
        email: `${nm.toLowerCase().replace(/\s+/g,'.')}@bcc.local`, phone: '+960 7' + (1000000 + i),
        weekly_hour_limit: 48, eligible_shift_ids: [], unavailable_days: [],
        hourly_rate: 5 + (i % 4), base_salary: null, active: true,
        created_at: now(), updated_at: now(),
      };
      db.staff.push(staff);
      // login user for staff
      db.users.push({
        id: uid(), email: `${branch.slug}-staff${i+1}@bcc.local`, name: nm,
        role: 'staff', branch_id: branch.id, staff_id: staff.id, active: true,
        password: 'bcc2026', created_at: now(),
      });
    });
  };

  seedPeople(seed, 'Aisha Manager', ['Nafha','Jaxly','Nihaal','Jaish']);
  seedPeople(am,   'Hussain Manager', ['Mohamed Naseem','Zeenath Adam','Yoosuf Latheef','Aishath Rishfa','Ahmed Shameel']);
  seedPeople(ch,   'Layla Manager', ['Hawwa Ibrahim','Ali Hassan','Naazim Rasheed','Mariyam Lubna','Ismail Hameed']);

  // Generate sample published roster for current week per branch
  [seed, am, ch].forEach(b => generateRosterForBranch(b.id, mondayOf(new Date()), 'published'));

  // Sample leave + swap for the demo
  const seedStaff = db.staff.filter(s => s.branch_id === seed.id);
  if (seedStaff.length >= 2) {
    db.leaves.push({
      id: uid(), staff_id: seedStaff[0].id,
      from_date: addDays(new Date(), 5).toISOString(),
      to_date: addDays(new Date(), 7).toISOString(),
      reason: 'Family event', status: 'pending', created_at: now(),
    });
  }

  console.log('[demo] seeded:', {
    branches: db.branches.length, staff: db.staff.length, users: db.users.length,
    shifts: db.shiftTypes.length, rosters: db.rosters.length, duties: db.duties.length,
  });
}

/* ---------------- Roster generator ---------------- */
function mondayOf(d = new Date()) {
  const x = new Date(d); const dow = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dow); x.setHours(0,0,0,0); return x;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function combine(date, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const x = new Date(date); x.setHours(h, m, 0, 0); return x;
}
function shiftHours(st) {
  let s = combine(new Date('2000-01-01'), st.start_time);
  let e = combine(new Date('2000-01-01'), st.end_time);
  if (e <= s) e = addDays(e, 1);
  return Math.max(0, (e - s) / 3600000 - (st.break_minutes || 0) / 60);
}

function generateRosterForBranch(branchId, weekStart, statusOverride = 'draft') {
  const branch = db.branches.find(b => b.id === branchId);
  if (!branch) return null;
  // remove existing roster for this week
  const existing = db.rosters.find(r => r.branch_id === branchId && new Date(r.week_start).getTime() === weekStart.getTime());
  if (existing) {
    db.duties = db.duties.filter(d => d.roster_id !== existing.id);
    db.rosters = db.rosters.filter(r => r.id !== existing.id);
  }
  const roster = {
    id: uid(), branch_id: branchId, week_start: weekStart.toISOString(),
    status: statusOverride, generated_by: null,
    published_at: statusOverride === 'published' ? now() : null,
    locked_at: null, notes: null, created_at: now(), updated_at: now(),
  };
  db.rosters.push(roster);

  const branchStaff = db.staff.filter(s => s.branch_id === branchId && s.active);
  const branchShifts = db.shiftTypes.filter(s => s.branch_id === branchId && s.active);
  const weekHrs = {}; const weekShifts = {}; const lastEnd = {}; const dayAssigned = {};
  branchStaff.forEach(s => { weekHrs[s.id] = 0; weekShifts[s.id] = 0; });

  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const date = addDays(weekStart, dayOffset);
    for (const st of branchShifts) {
      const startAt = combine(date, st.start_time);
      let endAt = combine(date, st.end_time); if (endAt <= startAt) endAt = addDays(endAt, 1);
      const hrs = shiftHours(st);
      const pool = branchStaff.filter(s => {
        const dk = `${s.id}_${date.toISOString().slice(0,10)}`;
        if (dayAssigned[dk]) return false;
        if (weekShifts[s.id] >= branch.max_shifts_per_week) return false;
        if (weekHrs[s.id] + hrs > Math.min(branch.max_hours_per_week, s.weekly_hour_limit)) return false;
        if (lastEnd[s.id] && (startAt - lastEnd[s.id]) / 3600000 < branch.min_rest_hours) return false;
        return true;
      }).sort((a,b) => weekHrs[a.id] - weekHrs[b.id]);

      pool.slice(0, st.required_staff || 1).forEach(s => {
        const duty = {
          id: uid(), roster_id: roster.id, staff_id: s.id, shift_type_id: st.id,
          date: date.toISOString(), start_at: startAt.toISOString(), end_at: endAt.toISOString(),
          status: 'scheduled', is_overtime: false, is_holiday: false,
          is_night: !!st.is_night, notes: null, created_at: now(), updated_at: now(),
        };
        db.duties.push(duty);
        weekHrs[s.id] += hrs; weekShifts[s.id] += 1; lastEnd[s.id] = endAt;
        dayAssigned[`${s.id}_${date.toISOString().slice(0,10)}`] = true;
      });
    }
  }
  return roster;
}

/* ---------------- Auth ---------------- */
function token(user) {
  const t = uid() + uid();
  db.tokens[t] = user.id;
  return t;
}
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!t || !db.tokens[t]) return res.status(401).json({ error: 'Missing/invalid token' });
  req.user = db.users.find(u => u.id === db.tokens[t]);
  if (!req.user) return res.status(401).json({ error: 'User not found' });
  next();
}
function need(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}
function audit(req, action, entity, entityId, payload = {}) {
  db.audit.push({
    id: uid(), user_id: req.user?.id || null, branch_id: payload.branch_id || req.user?.branch_id || null,
    action, entity, entity_id: entityId,
    user: req.user ? { name: req.user.name, email: req.user.email, role: req.user.role } : null,
    branch: payload.branch_id ? { name: db.branches.find(b => b.id === payload.branch_id)?.name } : null,
    reason: payload.reason || null, created_at: now(),
  });
}

/* ---------------- Helpers to enrich ---------------- */
function enrichStaff(s) { return { ...s, branch: db.branches.find(b => b.id === s.branch_id) || null, user: db.users.find(u => u.staff_id === s.id) || null }; }
function enrichDuty(d) {
  return { ...d,
    staff: db.staff.find(s => s.id === d.staff_id) || null,
    shift_type: db.shiftTypes.find(s => s.id === d.shift_type_id) || null,
    roster: db.rosters.find(r => r.id === d.roster_id) || null,
  };
}
function enrichRoster(r) {
  const duties = db.duties.filter(d => d.roster_id === r.id).map(enrichDuty);
  return { ...r, branch: db.branches.find(b => b.id === r.branch_id) || null, duties };
}
function enrichSwap(s) {
  return { ...s,
    from_duty: enrichDuty(db.duties.find(d => d.id === s.from_duty_id)),
    to_duty: s.to_duty_id ? enrichDuty(db.duties.find(d => d.id === s.to_duty_id)) : null,
    requester: db.staff.find(x => x.id === s.requester_id),
    receiver: db.staff.find(x => x.id === s.receiver_id),
  };
}

/* ---------------- Routes ---------------- */
// AUTH
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const u = db.users.find(x => x.email === (email || '').toLowerCase());
  if (!u || u.password !== password) return res.status(401).json({ error: 'Invalid credentials' });
  const t = token(u);
  res.json({
    access_token: t, refresh_token: t,
    user: { id: u.id, email: u.email, name: u.name, role: u.role, branch_id: u.branch_id, staff_id: u.staff_id, branch: db.branches.find(b => b.id === u.branch_id)?.name },
  });
});
app.post('/api/auth/refresh', (req, res) => {
  const { refresh_token } = req.body || {};
  if (!db.tokens[refresh_token]) return res.status(401).json({ error: 'Bad refresh' });
  res.json({ access_token: refresh_token, refresh_token });
});
app.post('/api/auth/logout', auth, (req, res) => { res.json({ ok: true }); });
app.get('/api/auth/me', auth, (req, res) => {
  const u = req.user;
  res.json({ id: u.id, email: u.email, name: u.name, role: u.role, branch_id: u.branch_id, staff_id: u.staff_id, branch: db.branches.find(b => b.id === u.branch_id)?.name, staff: u.staff_id ? db.staff.find(s => s.id === u.staff_id) : null });
});

// BRANCHES
app.get('/api/branches', auth, (req, res) => {
  const list = req.user.role === 'super_admin' ? db.branches : db.branches.filter(b => b.id === req.user.branch_id);
  res.json(list);
});
app.get('/api/branches/:id', auth, (req, res) => {
  const b = db.branches.find(x => x.id === req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  res.json(b);
});
app.post('/api/branches', auth, need('super_admin'), (req, res) => {
  const b = { id: uid(), active: true, operating_days: [0,1,2,3,4,5,6], weekend_days: [5,6],
    max_hours_per_day: 10, max_hours_per_week: 48, max_shifts_per_week: 6, min_rest_hours: 10, overtime_after_hrs: 8,
    ...req.body, created_at: now(), updated_at: now() };
  db.branches.push(b); audit(req, 'branch.create', 'Branch', b.id, { branch_id: b.id });
  res.status(201).json(b);
});
app.put('/api/branches/:id', auth, need('super_admin','branch_manager'), (req, res) => {
  const b = db.branches.find(x => x.id === req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  Object.assign(b, req.body, { updated_at: now() });
  audit(req, 'branch.update', 'Branch', b.id, { branch_id: b.id });
  res.json(b);
});

// STAFF
app.get('/api/staff', auth, (req, res) => {
  const branchId = req.query.branch_id || (req.user.role !== 'super_admin' ? req.user.branch_id : null);
  let list = db.staff;
  if (branchId) list = list.filter(s => s.branch_id === branchId);
  res.json(list.map(enrichStaff));
});
app.post('/api/staff', auth, need('super_admin','branch_manager'), (req, res) => {
  const { create_login, login_email, login_password, ...data } = req.body;
  const s = { id: uid(), employment_type: 'full_time', weekly_hour_limit: 48, eligible_shift_ids: [], unavailable_days: [], active: true, created_at: now(), updated_at: now(), ...data };
  db.staff.push(s);
  if (create_login && login_email && login_password) {
    db.users.push({ id: uid(), email: login_email.toLowerCase(), name: s.full_name, role: 'staff', branch_id: s.branch_id, staff_id: s.id, active: true, password: login_password });
  }
  audit(req, 'staff.create', 'Staff', s.id, { branch_id: s.branch_id });
  res.status(201).json(s);
});
app.put('/api/staff/:id', auth, need('super_admin','branch_manager'), (req, res) => {
  const s = db.staff.find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  Object.assign(s, req.body, { updated_at: now() });
  audit(req, 'staff.update', 'Staff', s.id, { branch_id: s.branch_id });
  res.json(s);
});

// SHIFTS
app.get('/api/shifts', auth, (req, res) => {
  const branchId = req.query.branch_id || (req.user.role !== 'super_admin' ? req.user.branch_id : null);
  let list = db.shiftTypes;
  if (branchId) list = list.filter(s => s.branch_id === branchId);
  res.json(list);
});
app.post('/api/shifts', auth, need('super_admin','branch_manager'), (req, res) => {
  const s = { id: uid(), break_minutes: 30, required_staff: 1, eligible_designations: [], is_night: false, active: true, created_at: now(), ...req.body };
  db.shiftTypes.push(s);
  audit(req, 'shift.create', 'ShiftType', s.id, { branch_id: s.branch_id });
  res.status(201).json(s);
});
app.put('/api/shifts/:id', auth, need('super_admin','branch_manager'), (req, res) => {
  const s = db.shiftTypes.find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  Object.assign(s, req.body);
  audit(req, 'shift.update', 'ShiftType', s.id, { branch_id: s.branch_id });
  res.json(s);
});

// ROSTER
app.get('/api/roster', auth, (req, res) => {
  const branchId = req.query.branch_id || (req.user.role !== 'super_admin' ? req.user.branch_id : null);
  let list = db.rosters;
  if (branchId) list = list.filter(r => r.branch_id === branchId);
  if (req.query.status) list = list.filter(r => r.status === req.query.status);
  res.json(list.map(r => ({ ...r, branch: db.branches.find(b => b.id === r.branch_id) })).sort((a,b) => new Date(b.week_start) - new Date(a.week_start)));
});
app.get('/api/roster/me/upcoming', auth, (req, res) => {
  if (!req.user.staff_id) return res.json([]);
  const upcoming = db.duties
    .filter(d => d.staff_id === req.user.staff_id)
    .filter(d => new Date(d.date) >= addDays(new Date(), -1))
    .filter(d => { const r = db.rosters.find(r => r.id === d.roster_id); return r && (r.status === 'published' || r.status === 'locked'); })
    .map(enrichDuty)
    .sort((a,b) => new Date(a.start_at) - new Date(b.start_at));
  res.json(upcoming);
});
app.get('/api/roster/:id', auth, (req, res) => {
  const r = db.rosters.find(x => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  res.json(enrichRoster(r));
});
app.post('/api/roster/generate', auth, need('super_admin','branch_manager'), (req, res) => {
  const branchId = req.body.branch_id;
  const week = mondayOf(new Date(req.body.week_start));
  const r = generateRosterForBranch(branchId, week, 'draft');
  audit(req, 'roster.generate', 'Roster', r.id, { branch_id: branchId });
  res.json(enrichRoster(r));
});
app.post('/api/roster/:id/publish', auth, need('super_admin','branch_manager'), (req, res) => {
  const r = db.rosters.find(x => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  r.status = 'published'; r.published_at = now();
  // notify all staff in roster
  const staffIds = [...new Set(db.duties.filter(d => d.roster_id === r.id).map(d => d.staff_id))];
  staffIds.forEach(sid => {
    const u = db.users.find(x => x.staff_id === sid);
    if (u) db.notifications.push({ id: uid(), user_id: u.id, title: 'New roster published', body: `Week of ${r.week_start.slice(0,10)}`, channel: 'in_app', created_at: now(), read_at: null });
  });
  audit(req, 'roster.publish', 'Roster', r.id, { branch_id: r.branch_id });
  res.json(r);
});
app.post('/api/roster/:id/lock', auth, need('super_admin','branch_manager'), (req, res) => {
  const r = db.rosters.find(x => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  r.status = 'locked'; r.locked_at = now();
  audit(req, 'roster.lock', 'Roster', r.id, { branch_id: r.branch_id });
  res.json(r);
});

// SWAPS
app.get('/api/swaps', auth, (req, res) => {
  let list = db.swaps;
  if (req.user.role === 'staff') list = list.filter(s => s.requester_id === req.user.staff_id || s.receiver_id === req.user.staff_id);
  else if (req.user.role === 'branch_manager') {
    list = list.filter(s => {
      const fromDuty = db.duties.find(d => d.id === s.from_duty_id);
      const r = fromDuty && db.rosters.find(r => r.id === fromDuty.roster_id);
      return r && r.branch_id === req.user.branch_id;
    });
  }
  if (req.query.status) list = list.filter(s => s.status === req.query.status);
  res.json(list.map(enrichSwap).sort((a,b) => new Date(b.created_at) - new Date(a.created_at)));
});
app.post('/api/swaps', auth, need('staff'), (req, res) => {
  const { from_duty_id, receiver_staff_id, reason } = req.body;
  const fromDuty = db.duties.find(d => d.id === from_duty_id);
  if (!fromDuty || fromDuty.staff_id !== req.user.staff_id) return res.status(403).json({ error: 'Not your duty' });
  const sw = { id: uid(), from_duty_id, to_duty_id: null, requester_id: req.user.staff_id, receiver_id: receiver_staff_id, status: 'pending_peer', reason, peer_at: null, manager_at: null, manager_id: null, rule_warnings: [], created_at: now(), updated_at: now() };
  db.swaps.push(sw);
  const recvUser = db.users.find(u => u.staff_id === receiver_staff_id);
  if (recvUser) db.notifications.push({ id: uid(), user_id: recvUser.id, title: 'Swap request received', body: `${req.user.name} wants to swap a duty.`, channel: 'in_app', created_at: now(), read_at: null });
  audit(req, 'swap.request', 'Swap', sw.id);
  res.status(201).json(sw);
});
app.post('/api/swaps/:id/respond', auth, need('staff'), (req, res) => {
  const sw = db.swaps.find(s => s.id === req.params.id);
  if (!sw || sw.receiver_id !== req.user.staff_id) return res.status(403).json({ error: 'Not your request' });
  if (!req.body.accept) { sw.status = 'peer_rejected'; sw.peer_at = now(); audit(req, 'swap.peer_reject', 'Swap', sw.id); return res.json(sw); }
  sw.status = 'pending_manager'; sw.peer_at = now();
  audit(req, 'swap.peer_accept', 'Swap', sw.id);
  res.json(sw);
});
app.post('/api/swaps/:id/decide', auth, need('super_admin','branch_manager'), (req, res) => {
  const sw = db.swaps.find(s => s.id === req.params.id);
  if (!sw) return res.status(404).json({ error: 'Not found' });
  if (!req.body.approve) { sw.status = 'rejected'; sw.manager_at = now(); sw.manager_id = req.user.id; sw.reason = req.body.reason || sw.reason; audit(req, 'swap.reject', 'Swap', sw.id); return res.json(sw); }
  // apply: switch staff on the from_duty
  const fromDuty = db.duties.find(d => d.id === sw.from_duty_id);
  if (fromDuty) { fromDuty.staff_id = sw.receiver_id; fromDuty.status = 'swapped'; }
  sw.status = 'approved'; sw.manager_at = now(); sw.manager_id = req.user.id;
  audit(req, 'swap.approve', 'Swap', sw.id);
  res.json(sw);
});

// LEAVES
app.get('/api/leaves', auth, (req, res) => {
  let list = db.leaves;
  if (req.user.role === 'staff') list = list.filter(l => l.staff_id === req.user.staff_id);
  else if (req.user.role === 'branch_manager') list = list.filter(l => db.staff.find(s => s.id === l.staff_id)?.branch_id === req.user.branch_id);
  if (req.query.status) list = list.filter(l => l.status === req.query.status);
  res.json(list.map(l => ({ ...l, staff: db.staff.find(s => s.id === l.staff_id) })));
});
app.post('/api/leaves', auth, (req, res) => {
  const staffId = req.user.role === 'staff' ? req.user.staff_id : req.body.staff_id;
  const l = { id: uid(), staff_id: staffId, from_date: new Date(req.body.from_date).toISOString(), to_date: new Date(req.body.to_date).toISOString(), reason: req.body.reason || null, status: 'pending', created_at: now() };
  db.leaves.push(l);
  audit(req, 'leave.request', 'Leave', l.id);
  res.status(201).json(l);
});
app.post('/api/leaves/:id/decide', auth, need('super_admin','branch_manager'), (req, res) => {
  const l = db.leaves.find(x => x.id === req.params.id);
  if (!l) return res.status(404).json({ error: 'Not found' });
  l.status = req.body.approve ? 'approved' : 'rejected';
  l.decided_by = req.user.id; l.decided_at = now();
  audit(req, req.body.approve ? 'leave.approve' : 'leave.reject', 'Leave', l.id);
  res.json(l);
});

// ATTENDANCE
app.get('/api/attendance', auth, (req, res) => {
  let list = db.attendance;
  const branchId = req.query.branch_id || (req.user.role !== 'super_admin' ? req.user.branch_id : null);
  if (branchId) list = list.filter(a => a.branch_id === branchId);
  if (req.query.from) list = list.filter(a => new Date(a.date) >= new Date(req.query.from));
  if (req.query.to) list = list.filter(a => new Date(a.date) <= new Date(req.query.to));
  res.json(list.map(a => ({ ...a, staff: db.staff.find(s => s.id === a.staff_id), duty: enrichDuty(db.duties.find(d => d.id === a.duty_id) || {}) })));
});
app.post('/api/attendance/clock-in', auth, need('staff'), (req, res) => {
  const duty = db.duties.find(d => d.id === req.body.duty_id);
  if (!duty || duty.staff_id !== req.user.staff_id) return res.status(403).json({ error: 'Not your duty' });
  const lateMin = Math.max(0, Math.round((new Date() - new Date(duty.start_at)) / 60000));
  let att = db.attendance.find(a => a.duty_id === duty.id);
  if (!att) {
    att = { id: uid(), duty_id: duty.id, staff_id: duty.staff_id, branch_id: db.rosters.find(r => r.id === duty.roster_id).branch_id, date: duty.date, scheduled_start: duty.start_at, scheduled_end: duty.end_at, actual_start: now(), actual_end: null, status: lateMin > 5 ? 'late' : 'worked', late_minutes: lateMin, overtime_hours: 0, remarks: null, created_at: now() };
    db.attendance.push(att);
  } else {
    att.actual_start = now(); att.late_minutes = lateMin; att.status = lateMin > 5 ? 'late' : 'worked';
  }
  res.json(att);
});
app.post('/api/attendance/clock-out', auth, need('staff'), (req, res) => {
  const att = db.attendance.find(a => a.duty_id === req.body.duty_id);
  if (!att) return res.status(404).json({ error: 'No clock-in record' });
  att.actual_end = now();
  att.overtime_hours = Math.max(0, (new Date() - new Date(att.scheduled_end)) / 3600000);
  if (att.overtime_hours > 0) att.status = 'overtime';
  res.json(att);
});
app.get('/api/attendance/me/summary', auth, need('staff'), (req, res) => {
  const month = parseInt(req.query.month) || new Date().getMonth() + 1;
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const list = db.attendance.filter(a => a.staff_id === req.user.staff_id && new Date(a.date).getMonth() + 1 === month && new Date(a.date).getFullYear() === year);
  const summary = list.reduce((acc, a) => { acc.total += 1; acc[a.status] = (acc[a.status] || 0) + 1; acc.overtime_hours += Number(a.overtime_hours || 0); return acc; }, { total: 0, overtime_hours: 0 });
  res.json({ month, year, summary, records: list });
});

// PAYROLL (preview only in demo; xlsx returns CSV-as-text for simplicity)
app.get('/api/payroll/preview', auth, need('super_admin','branch_manager'), (req, res) => {
  const branchId = req.query.branch_id;
  const year = parseInt(req.query.year), month = parseInt(req.query.month);
  // Demo: synthesize from current rosters
  const branchStaff = db.staff.filter(s => !branchId || s.branch_id === branchId);
  const rows = branchStaff.map(s => {
    const dutiesThisMonth = db.duties.filter(d => d.staff_id === s.id && new Date(d.date).getMonth() + 1 === month && new Date(d.date).getFullYear() === year);
    return {
      employee_id: s.employee_id, name: s.full_name, branch: db.branches.find(b => b.id === s.branch_id)?.name || '',
      designation: s.designation || '',
      scheduled_days: dutiesThisMonth.length,
      worked_days: dutiesThisMonth.length,
      off_days: 0, leave_days: 0, absences: 0, late_count: 0,
      overtime_hours: 0, holiday_duties: 0, night_shifts: dutiesThisMonth.filter(d => d.is_night).length,
      swaps: 0, remarks: [],
    };
  });
  res.json(rows);
});
app.get('/api/payroll/export.csv', auth, need('super_admin','branch_manager'), async (req, res) => {
  const rows = await new Promise((resolve) => {
    res.locals._capture = (data) => resolve(data);
    const fakeRes = { json: (d) => res.locals._capture(d) };
    app._router.handle({ method: 'GET', url: `/api/payroll/preview?branch_id=${req.query.branch_id || ''}&year=${req.query.year}&month=${req.query.month}`, headers: req.headers, query: req.query }, fakeRes, () => {});
  });
  const headers = ['employee_id','name','branch','designation','scheduled_days','worked_days','overtime_hours'];
  const csv = [headers.join(',')].concat(rows.map(r => headers.map(h => JSON.stringify(r[h] ?? '')).join(','))).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="payroll_${req.query.year}_${String(req.query.month).padStart(2,'0')}.csv"`);
  res.send(csv);
});
app.get('/api/payroll/export.xlsx', auth, need('super_admin','branch_manager'), (req, res) => {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="payroll_${req.query.year}_${String(req.query.month).padStart(2,'0')}.csv"`);
  res.send('Demo mode: Excel export needs the real backend. CSV export works.');
});

// NOTIFICATIONS
app.get('/api/notifications', auth, (req, res) => {
  res.json(db.notifications.filter(n => n.user_id === req.user.id).sort((a,b) => new Date(b.created_at) - new Date(a.created_at)));
});
app.get('/api/notifications/unread-count', auth, (req, res) => {
  res.json({ count: db.notifications.filter(n => n.user_id === req.user.id && !n.read_at).length });
});
app.post('/api/notifications/:id/read', auth, (req, res) => {
  const n = db.notifications.find(x => x.id === req.params.id && x.user_id === req.user.id);
  if (n) n.read_at = now();
  res.json({ ok: true });
});

// AUDIT
app.get('/api/audit', auth, need('super_admin','branch_manager'), (req, res) => {
  let list = db.audit;
  const branchId = req.query.branch_id || (req.user.role !== 'super_admin' ? req.user.branch_id : null);
  if (branchId) list = list.filter(l => l.branch_id === branchId);
  res.json(list.sort((a,b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, parseInt(req.query.limit) || 200));
});

// HEALTH
app.get('/health', (req, res) => res.json({ status: 'ok', mode: 'demo' }));

// Static frontend
app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html')));

// Error handler
app.use((err, req, res, next) => {
  console.error('[err]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

/* ---------------- Start ---------------- */
seed();
const PORT = process.env.PORT || 4001;
app.listen(PORT, () => {
  console.log('');
  console.log('  ╔═════════════════════════════════════════════╗');
  console.log('  ║  BCC Duty & Roster — DEMO MODE              ║');
  console.log('  ║  http://localhost:' + PORT + '                       ║');
  console.log('  ╠═════════════════════════════════════════════╣');
  console.log('  ║  Logins (all use password: bcc2026)         ║');
  console.log('  ║                                             ║');
  console.log('  ║  Super admin:   admin@bcc.local             ║');
  console.log('  ║  SEED manager:  seed-manager@bcc.local      ║');
  console.log('  ║  AM   manager:  authentic-maldives-manager@bcc.local ║');
  console.log('  ║  CH   manager:  creator-hub-manager@bcc.local ║');
  console.log('  ║                                             ║');
  console.log('  ║  Staff:         seed-staff1@bcc.local       ║');
  console.log('  ║                 (or staff2..6)              ║');
  console.log('  ╚═════════════════════════════════════════════╝');
  console.log('');
});
