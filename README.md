# לוח מודיעין תחרותי – סושיאל ופרסום (Hebrew RTL dashboard)

אתר סטטי, ללא תלויות. `npm run build` קורא את `data/data.json` ומייצר `dist/`.

## עדכון שבועי
1. פתחו `data/data.json` → מערך `scans`.
2. העתיקו את האובייקט האחרון, שנו `id` (YYYY-MM-DD), `date`, `statusLabel`, ועדכנו מספרים/קישורי Drive.
3. `npm run build` ← הדף הראשי מציג את הסריקה האחרונה, מסמן Δ מול הקודמת, והקודמות נשמרות ב-`/archive/<id>/`.

מותגים (`brands`) ואירועים (`events`) מוגדרים פעם אחת. הלוח מציג רק מספרים שמופיעים בדוחות – אין להמציא נתונים.
פונט: Heebo (Google Fonts CDN, ללא סקריפטים). ללא אנליטיקה/מעקב/עוגיות. `noindex`.

## קריאייטיבים, Top 10 וייבוא נכסים

- סדר הלשוניות לפי חשיבות, והראשונה היא ברירת המחדל: **Top 10 השבוע** (סטוריבורד שבועי, צילומי מצב לפי שבוע ISO ב-`data/top10.json`), **קריאייטיבים חזקים** (גלריה עם סינון/מיון/הגדלה), סקירה כללית, מגמות ועונתיות, מתחרים, Meta, TikTok, Google, נראות אורגנית, המלצות ליישום, מיילרים. הסדר קבוע ב-`scripts/build.mjs` (`TAB_ORDER`). סיכונים רגולטוריים הם תת-סעיף בתוך המלצות (`#regulatory`). מגבלות וכיסוי נפתחות מהפוטר או מאייקון i בכותרת (`#limits`) — לא כלשונית.
- הנתונים נוצרים מתיקיית הנכסים של הבוטים (`/workspace/social/creatives/{meta,tiktok,organic}/index.json`) ע״י: `node scripts/import-creatives.mjs [srcDir] [--asof YYYY-MM-DD]`. הסקריפט מכווץ תמונות ל-WebP (עד 150KB, דורש python3+Pillow), כותב `public/creatives/**`, `data/creatives.json` ו-`data/top10.json`. את התוצאה מבצעים commit – ה-build עצמו (`npm run build`) לא דורש תלויות.
- שדות נתמכים ב-index.json: `brand, library_id, file, format, platform, start_date, days_active, status, copy_text, cta, offer, creative_notes, library_url, variants_count, family` (Meta); `brand, video_url|post_url, file, post_date, days_since_posted, views, likes, comments, shares, type, hook, creative_notes, language` (TikTok/אורגני).
- דירוג Top 10 של מודעות Meta: ותק ריצה, אח״כ מספר גרסאות (עד 2 למותג). תוכן אורגני מדורג בנפרד לפי צפיות ומסומן בבירור.

## דפי אפיון (אפיון / תסריט ל-Nully / מיילרים) – לבוטים
- קבצי HTML מלאים נשמרים ב-`specs/` (רק גרסת v2/האחרונה). ה-build מעתיק אותם ל-`dist/specs/` ומוסיף פס עליון "חזרה ללוח" – התוכן עצמו לא משתנה. כתובת: `/specs/<שם-קובץ-בלי-.html>` (cleanUrls).
- המיפוי ב-`data/specs.json`:
  - `items`: מפתח = מזהה ספריית Meta (`library_id`) או מזהה הווידאו המספרי שב-`post_url` (TikTok). ערך = מערך `{ "label": "אפיון" | "תסריט ל-Nully", "file": "<קובץ ב-specs/>" }`.
  - `mailers`: מערך `{ brand, title, file }` – מוצג בלשונית **מיילרים**.
- הוספת אפיון חדש: (1) העתיקו את הקובץ ל-`specs/` בשם `meta-<brand>-<id>.html` / `tiktok-<brand>-<id>-spec.html` / `-nully.html` / `mailer-<brand>.html`; (2) הוסיפו רשומה ב-`data/specs.json`; (3) `npm run build` ובדקו ש-`data-spec="1"` מופיע; commit + push ל-main.
- כרטיסים עם אפיון מקבלים תגית סגולה בגלריה וב-Top 10, ויש סינון "עם אפיון" בגלריה. מזהה ללא כרטיס תואם פשוט לא יוצג (בדקו ב-`data/creatives.json`).

## Top 10 — מתחרים בנישה
- בכל שבוע ב-`data/top10.json` נשמרים גם `niche` (עד 10 מודעות Meta) ו-`nicheBrands` – המותגים עם `"group": "niche"` ב-`data/data.json`.
- הדירוג זהה ל-Top 10 הראשי (`rankTop10` ב-`scripts/creatives.mjs`) ומחושב ב-`import-creatives.mjs` (העדכון היומי). אם בצילום של השבוע האחרון אין `niche`, ה-build מחשב אותו מ-`creatives.json`. כשיש פחות מ-10 מודעות שעומדות בתנאים, מוצג מה שקיים עם הערה.

## אפיוני מודעות בכמות + תובנות רוחב
- `data/specs.json` ממפה **כל** מזהה במשפחת מודעות לאותו מסמך (לפי `ids` ב-`/workspace/social/ad-specs/queue.json`). שם קובץ: `meta-<brand>-<primary_id>.html`. לווידאו: `tiktok-<brand>-<id>-spec.html` / `-nully.html` עם מפתח = מזהה הווידאו.
- תובנות: קובצי Markdown ב-`data/insights/*.md` מוצגים כ-`/insights/<name>` (ממיר פשוט `scripts/md.mjs`, עוטף מונחים לטיניים ב-bdi). `niche-cross.md` הוא התרגום לעברית; המקור באנגלית ב-`data/insights-src/niche-cross.en.md` (לא מוצג).

## אפיוני וידאו – סנכרון
`node scripts/sync-video-specs.mjs [/workspace/social/video-specs]` סורק `<brand>/<id>_spec[-v2].html` ו-`<id>_script_nully[-v2].html` (מעדיף -v2, מדלג על pilot/fullrun), מעתיק ל-`specs/` ומוסיף ל-`data/specs.json` תגיות 'אפיון' + 'תסריט ל-Nully' (מזהה 19 ספרות = TikTok, 15–16 = Meta). אפיון תמונה קיים נשמר והווידאו נוסף כ-'אפיון וידאו'. בטוח להרצה חוזרת; מדפיס מזהים ללא כרטיס. אחר כך build, commit, push.
