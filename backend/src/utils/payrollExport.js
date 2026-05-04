const ExcelJS = require('exceljs');
const { stringify } = require('csv-stringify/sync');
const prisma = require('../lib/prisma');

async function buildPayrollRows({ branchId, year, month }) {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 1));

  const where = { date: { gte: from, lt: to } };
  if (branchId) where.branch_id = branchId;

  const attendance = await prisma.attendance.findMany({
    where,
    include: { staff: true, branch: true, duty: { include: { shift_type: true } } },
    orderBy: [{ staff_id: 'asc' }, { date: 'asc' }],
  });

  // Aggregate by staff
  const map = new Map();
  for (const a of attendance) {
    const k = a.staff_id;
    if (!map.has(k)) map.set(k, {
      employee_id: a.staff.employee_id,
      name: a.staff.full_name,
      branch: a.branch.name,
      designation: a.staff.designation || '',
      scheduled_days: 0,
      worked_days: 0,
      off_days: 0,
      leave_days: 0,
      absences: 0,
      late_count: 0,
      overtime_hours: 0,
      holiday_duties: 0,
      night_shifts: 0,
      swaps: 0,
      remarks: [],
    });
    const r = map.get(k);
    r.scheduled_days += 1;
    if (a.status === 'worked' || a.status === 'late' || a.status === 'overtime' || a.status === 'holiday_worked') r.worked_days += 1;
    if (a.status === 'on_leave') r.leave_days += 1;
    if (a.status === 'absent') r.absences += 1;
    if (a.status === 'late') r.late_count += 1;
    if (a.status === 'swapped') r.swaps += 1;
    if (a.status === 'holiday_worked') r.holiday_duties += 1;
    if (a.duty?.is_night) r.night_shifts += 1;
    r.overtime_hours += Number(a.overtime_hours || 0);
    if (a.remarks) r.remarks.push(a.remarks);
  }
  return [...map.values()];
}

async function exportXlsx(opts) {
  const rows = await buildPayrollRows(opts);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`Payroll ${opts.year}-${String(opts.month).padStart(2,'0')}`);
  ws.columns = [
    { header: 'Employee ID', key: 'employee_id', width: 14 },
    { header: 'Name', key: 'name', width: 26 },
    { header: 'Branch', key: 'branch', width: 20 },
    { header: 'Designation', key: 'designation', width: 18 },
    { header: 'Scheduled Days', key: 'scheduled_days', width: 14 },
    { header: 'Worked Days', key: 'worked_days', width: 12 },
    { header: 'Off Days', key: 'off_days', width: 10 },
    { header: 'Leave Days', key: 'leave_days', width: 12 },
    { header: 'Absences', key: 'absences', width: 10 },
    { header: 'Late Count', key: 'late_count', width: 11 },
    { header: 'Overtime Hrs', key: 'overtime_hours', width: 13 },
    { header: 'Holiday Duties', key: 'holiday_duties', width: 14 },
    { header: 'Night Shifts', key: 'night_shifts', width: 12 },
    { header: 'Swaps', key: 'swaps', width: 8 },
    { header: 'Remarks', key: 'remarks', width: 40 },
  ];
  rows.forEach((r) => ws.addRow({ ...r, remarks: r.remarks.join('; ') }));
  ws.getRow(1).font = { bold: true };
  return wb.xlsx.writeBuffer();
}

async function exportCsv(opts) {
  const rows = await buildPayrollRows(opts);
  return stringify(rows.map((r) => ({ ...r, remarks: r.remarks.join('; ') })), { header: true });
}

module.exports = { buildPayrollRows, exportXlsx, exportCsv };
