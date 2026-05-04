require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const prisma = require('../src/lib/prisma');

async function main() {
  console.log('Seeding…');

  const branches = [
    { name: 'SEED', slug: 'seed', location: 'Maldives', operating_days: [0,1,2,3,4,5,6], open_time: '08:00', close_time: '23:00' },
    { name: 'Authentic Maldives', slug: 'authentic-maldives', location: 'Maldives', operating_days: [0,1,2,3,4,5,6], open_time: '09:00', close_time: '22:00' },
    { name: 'Creator Hub', slug: 'creator-hub', location: 'Maldives', operating_days: [0,1,2,3,4,5,6], open_time: '09:00', close_time: '21:00' },
  ];

  for (const b of branches) {
    const created = await prisma.branch.upsert({
      where: { slug: b.slug },
      update: {},
      create: { ...b, weekend_days: [5, 6] },
    });
    console.log(`  branch: ${created.name}`);

    // default shift types
    const defaults = [
      { name: 'Morning', start_time: '08:00', end_time: '14:00', break_minutes: 30, required_staff: 2 },
      { name: 'Evening', start_time: '14:00', end_time: '22:00', break_minutes: 60, required_staff: 2 },
      { name: 'Full Day', start_time: '09:00', end_time: '18:00', break_minutes: 60, required_staff: 1 },
    ];
    for (const s of defaults) {
      await prisma.shiftType.upsert({
        where: { branch_id_name: { branch_id: created.id, name: s.name } },
        update: {},
        create: { ...s, branch_id: created.id, eligible_designations: [] },
      });
    }
  }

  const adminEmail = 'admin@bcc.local';
  const exists = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!exists) {
    await prisma.user.create({
      data: {
        email: adminEmail,
        name: 'Super Admin',
        password_hash: await bcrypt.hash('ChangeMe123!', 10),
        role: 'super_admin',
      },
    });
    console.log(`  super_admin: ${adminEmail} / ChangeMe123!`);
  } else {
    console.log(`  super_admin already exists: ${adminEmail}`);
  }

  console.log('Done.');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
