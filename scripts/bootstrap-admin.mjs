#!/usr/bin/env node
// One-time: give the founder (seeded as admin in the Team table) a login.
// Run locally with the project's secret key in your shell environment; nothing is written to disk.
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run bootstrap-admin
// It refuses to run once an admin login exists. Add everyone else from the Team page.
import { createClient } from '@supabase/supabase-js';
import readline from 'node:readline';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your shell first.');
  process.exit(1);
}

function ask(question, { hidden = false } = {}) {
  const fromEnv = process.env[`BOOTSTRAP_${question.key}`];
  if (fromEnv) return Promise.resolve(fromEnv);
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => rl.output.write(s.includes(question.text) ? s : '*');
    }
    rl.question(question.text, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const name = (await ask({ key: 'NAME', text: 'Team member to make admin [Kartik]: ' })) || 'Kartik';
const { data: member, error: mErr } = await supabase.from('members').select('id, name, user_id').eq('name', name).maybeSingle();
if (mErr || !member) {
  console.error(`No team member named "${name}" was found.`);
  process.exit(1);
}
const username = (await ask({ key: 'USERNAME', text: `Username for ${name} [${name.toLowerCase()}]: ` })) || name.toLowerCase();
if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
  console.error('Username must be 3-32 lowercase letters, digits, dot, dash or underscore.');
  process.exit(1);
}
const password = await ask({ key: 'PASSWORD', text: 'Password (10+ chars, letters and digits): ' }, { hidden: true });
if (password.length < 10 || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
  console.error('Password must be at least 10 characters and include a letter and a digit.');
  process.exit(1);
}
const pin = await ask({ key: 'PIN', text: '3-digit PIN: ' }, { hidden: true });
if (!/^\d{3}$/.test(pin)) {
  console.error('PIN must be exactly 3 digits.');
  process.exit(1);
}

const { data: created, error: cErr } = await supabase.auth.admin.createUser({
  email: `${username}@users.opspulse.invalid`,
  password,
  email_confirm: true,
  app_metadata: { provisioned_by: 'opspulse-bootstrap' },
});
if (cErr) {
  console.error(`Could not create the login: ${cErr.message}`);
  process.exit(1);
}
const { error: bErr } = await supabase.rpc('service_bootstrap_admin', {
  p_member: member.id,
  p_user: created.user.id,
  p_username: username,
  p_pin: pin,
});
if (bErr) {
  await supabase.auth.admin.deleteUser(created.user.id);
  console.error(`Not completed: ${bErr.message}`);
  process.exit(1);
}
console.log(`Done. ${name} can now sign in as "${username}" with that password and PIN.`);
