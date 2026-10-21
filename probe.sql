WITH RECURSIVE s(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM s WHERE x<30000)
INSERT INTO content_page (slug,kind,title_bn,title_en,body_md,updated_at)
SELECT 'probe-'||x,'test','x','x','x','2026-10-21' FROM s;
