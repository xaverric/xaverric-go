const LINK_COLUMNS = "slug, url, created_at, updated_at, expires_at, disabled_at, clicks, last_click_at";

export const findActiveLink = (db, slug, nowIso) =>
  db.prepare("SELECT slug, url FROM links WHERE slug = ?1 AND disabled_at IS NULL AND (expires_at IS NULL OR expires_at > ?2)").bind(slug, nowIso).first();

export const recordClick = (db, { slug, day, country, referrer, nowIso }) =>
  db.batch([
    db.prepare("UPDATE links SET clicks = clicks + 1, last_click_at = ?2 WHERE slug = ?1").bind(slug, nowIso),
    db
      .prepare(
        `INSERT INTO clicks_daily (slug, day, country, referrer_host, count) SELECT ?1, ?2, ?3, ?4, 1 WHERE EXISTS (SELECT 1 FROM links WHERE slug = ?1)
         ON CONFLICT (slug, day, country, referrer_host) DO UPDATE SET count = count + 1`,
      )
      .bind(slug, day, country, referrer),
  ]);

export const listLinks = async (db) => (await db.prepare(`SELECT ${LINK_COLUMNS} FROM links ORDER BY created_at DESC, slug`).all()).results;

export const getLink = (db, slug) => db.prepare(`SELECT ${LINK_COLUMNS} FROM links WHERE slug = ?1`).bind(slug).first();

export const insertLink = (db, { slug, url, expiresAt, nowIso }) =>
  db
    .prepare(`INSERT INTO links (slug, url, created_at, expires_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (slug) DO NOTHING RETURNING ${LINK_COLUMNS}`)
    .bind(slug, url, nowIso, expiresAt)
    .first();

export const updateLink = (db, slug, { url, disabled, expiresAt }, nowIso) =>
  db
    .prepare(
      `UPDATE links SET
         url = COALESCE(?2, url),
         disabled_at = CASE ?3 WHEN 1 THEN COALESCE(disabled_at, ?5) WHEN 0 THEN NULL ELSE disabled_at END,
         expires_at = CASE ?4 WHEN 1 THEN ?6 ELSE expires_at END,
         updated_at = ?5
       WHERE slug = ?1 RETURNING ${LINK_COLUMNS}`,
    )
    .bind(slug, url ?? null, disabled === undefined ? null : Number(disabled), Number(expiresAt !== undefined), nowIso, expiresAt ?? null)
    .first();

export const deleteLink = async (db, slug) => (await db.prepare("DELETE FROM links WHERE slug = ?1").bind(slug).run()).meta.changes > 0;

const topBy = async (db, column, slug, since) =>
  (
    await db
      .prepare(`SELECT ${column} AS key, SUM(count) AS clicks FROM clicks_daily WHERE slug = ?1 AND day >= ?2 GROUP BY ${column} ORDER BY clicks DESC, key LIMIT 10`)
      .bind(slug, since)
      .all()
  ).results;

export const linkStats = async (db, slug, since) => {
  const daily = await db.prepare("SELECT day, SUM(count) AS clicks FROM clicks_daily WHERE slug = ?1 AND day >= ?2 GROUP BY day").bind(slug, since).all();
  return { daily: daily.results, countries: await topBy(db, "country", slug, since), referrers: await topBy(db, "referrer_host", slug, since) };
};

export const upsertUser = (db, { githubId, login, name, avatarUrl }, nowIso) =>
  db
    .prepare(
      `INSERT INTO users (github_id, login, name, avatar_url, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (github_id) DO UPDATE SET login = excluded.login, name = excluded.name, avatar_url = excluded.avatar_url
       RETURNING id`,
    )
    .bind(githubId, login, name, avatarUrl, nowIso)
    .first();

export const upsertDevUser = async (db, login, nowIso) =>
  (await db.prepare("SELECT id FROM users WHERE login = ?1 AND github_id < 0").bind(login).first()) ??
  db
    .prepare(
      `INSERT INTO users (github_id, login, name, avatar_url, created_at)
       VALUES ((SELECT MIN(0, COALESCE(MIN(github_id), 0)) - 1 FROM users), ?1, ?1, NULL, ?2) RETURNING id`,
    )
    .bind(login, nowIso)
    .first();
