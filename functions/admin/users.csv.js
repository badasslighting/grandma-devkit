// Signed-in admins (ADMIN_EMAILS) can download the user list.
export async function onRequestGet({ env, data }) {
  const admins = (env.ADMIN_EMAILS || '').toLowerCase().split(',').map(s => s.trim());
  if (!data.user || !admins.includes(data.user.email)) return new Response('Forbidden', { status: 403 });
  const { results } = await env.DB.prepare(
    'SELECT email, name, first_seen, last_seen, visits, blocked FROM users ORDER BY last_seen DESC'
  ).all();
  // Prefix formula-looking cells so a spreadsheet won't run them.
  const q = v => '"' + String(v ?? '').replace(/^[=+\-@]/, "'$&").replace(/"/g, '""') + '"';
  const iso = t => new Date(t * 1000).toISOString();
  const rows = results.map(r => [r.email, r.name, iso(r.first_seen), iso(r.last_seen), r.visits, r.blocked].map(q).join(','));
  return new Response(['email,name,first_seen,last_seen,visits,blocked', ...rows].join('\n'), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="users.csv"' },
  });
}
