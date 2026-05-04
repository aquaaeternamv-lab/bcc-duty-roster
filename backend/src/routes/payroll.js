const router = require('express').Router();
const { authenticate, authorize, scopeBranch } = require('../middleware/auth');
const { logAudit } = require('../utils/auditLog');
const { buildPayrollRows, exportXlsx, exportCsv } = require('../utils/payrollExport');

router.use(authenticate);

router.get('/preview', authorize('super_admin', 'branch_manager'), async (req, res) => {
  const branchId = scopeBranch(req, req.query.branch_id);
  const year = parseInt(req.query.year);
  const month = parseInt(req.query.month);
  if (!year || !month) return res.status(400).json({ error: 'year and month required' });
  const rows = await buildPayrollRows({ branchId, year, month });
  res.json(rows);
});

router.get('/export.xlsx', authorize('super_admin', 'branch_manager'), async (req, res) => {
  const branchId = scopeBranch(req, req.query.branch_id);
  const year = parseInt(req.query.year);
  const month = parseInt(req.query.month);
  const buf = await exportXlsx({ branchId, year, month });
  await logAudit({ user: req.user, branchId, action: 'payroll.export.xlsx', entity: 'Payroll', newValue: { year, month } });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="payroll_${year}_${String(month).padStart(2,'0')}.xlsx"`);
  res.send(Buffer.from(buf));
});

router.get('/export.csv', authorize('super_admin', 'branch_manager'), async (req, res) => {
  const branchId = scopeBranch(req, req.query.branch_id);
  const year = parseInt(req.query.year);
  const month = parseInt(req.query.month);
  const csv = await exportCsv({ branchId, year, month });
  await logAudit({ user: req.user, branchId, action: 'payroll.export.csv', entity: 'Payroll', newValue: { year, month } });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="payroll_${year}_${String(month).padStart(2,'0')}.csv"`);
  res.send(csv);
});

module.exports = router;
