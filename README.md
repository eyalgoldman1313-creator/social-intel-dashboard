# לוח מודיעין תחרותי – סושיאל ופרסום (Hebrew RTL dashboard)

אתר סטטי. `npm run build` קורא את `data/data.json` ומייצר `dist/` בלי תלויות. `@hebcal/core` משמש רק ליצירת `data/events.json` ולבדיקות.

## עדכון שבועי
1. פתחו `data/data.json` → מערך `scans`.
2. העתיקו את האובייקט האחרון, שנו `id` (YYYY-MM-DD), `date`, `statusLabel`, ועדכנו מספרים/קישורי Drive.
3. `npm run build` ← הדף הראשי מציג את הסריקה האחרונה, מסמן Δ מול הקודמת, והקודמות נשמרות ב-`/archive/<id>/`.

מותגים (`brands`) מוגדרים פעם אחת. אירועי מסחר וחגים נשמרים ב-`data/events.json`. הלוח מציג רק מספרים שמופיעים בדוחות – אין להמציא נתונים.
פונט: Heebo (Google Fonts CDN, ללא סקריפטים). ללא אנליטיקה/מעקב/עוגיות. `noindex`.

## אירועי מסחר (`data/events.json`)

מערך של `{ "name", "start", "end?", "type": "sale" | "holiday" | "season", "relevance": "high" | "medium" | "low", "note?" }`. תאריכים ב-ISO (`YYYY-MM-DD`). `end` רק כשיש טווח.

חגים עבריים לא מוקלדים ידנית. `node scripts/resolve-events.mjs --write` בונה את הקובץ מ-`@hebcal/core` (ישראל) ומוסיף תאריכים אזרחיים וחופשות בית ספר. חבילת Hebcal היא devDependency של הסקריפט והבדיקות; `npm run build` לא מייבא אותה.

הכותרת ולשונית «מגמות ועונתיות» מסננות בדפדפן, לפי התאריך האזרחי בישראל: אירוע שהסתיים נעלם, ומוצג רק מה שמתחיל בתוך 120 יום — בלי בנייה מחדש. בכותרת מוצגים עד 3 האירועים הקרובים (2 במסך צר) כצ׳יפים, והשאר ברצועה שנעה לבד בכיוון הקריאה (לולאה חלקה). הרצועה נעצרת במעבר, במגע ובמיקוד. אם הפריטים נכנסים כולם, אין תנועה. ב-`prefers-reduced-motion` אין אנימציה, ונשארת גלילה ידנית בלי פס גלילה. אירוע עם `relevance: "low"` מעומעם ומופיע אחרי השאר, ולא נכנס לצ׳יפים כל עוד יש אירוע אחר בחלון.

## קריאייטיבים, Top 10 וייבוא נכסים

- סדר הלשוניות לפי חשיבות, והראשונה היא ברירת המחדל: **Top 10 השבוע** (סטוריבורד שבועי, צילומי מצב לפי שבוע ISO ב-`data/top10.json`), **קריאייטיבים חזקים** (גלריה עם סינון/מיון/הגדלה), סקירה כללית, מגמות ועונתיות, מתחרים, Meta, TikTok, Google, נראות אורגנית, המלצות ליישום, מיילרים. הסדר קבוע ב-`scripts/build.mjs` (`TAB_ORDER`). סיכונים רגולטוריים הם תת-סעיף בתוך המלצות (`#regulatory`). מגבלות וכיסוי נפתחות מהפוטר או מאייקון i בכותרת (`#limits`) — לא כלשונית.
- הנתונים נוצרים מתיקיית הנכסים של הבוטים (`/workspace/social/creatives/{meta,tiktok,organic}/index.json`) ע״י: `node scripts/import-creatives.mjs [srcDir] [--asof YYYY-MM-DD]`. הסקריפט מכווץ תמונות ל-WebP (עד 150KB, דורש python3+Pillow), כותב `public/creatives/**`, `data/creatives.json` ו-`data/top10.json`. את התוצאה מבצעים commit – ה-build עצמו (`npm run build`) לא דורש תלויות.
- שדות נתמכים ב-index.json: `brand, library_id, file, format, platform, start_date, days_active, status, copy_text, cta, offer, creative_notes, library_url, variants_count, family` (Meta); `brand, video_url|post_url, file, post_date, days_since_posted, views, likes, comments, shares, type, hook, creative_notes, language` (TikTok/אורגני).
- דירוג Top 10 של מודעות Meta: ותק ריצה, אח״כ מספר גרסאות, עד 2 למותג ומשפחה אחת פעם אחת. התמונה משמשת לתצוגה בלבד ואינה משפיעה על הדירוג. תוכן אורגני מדורג בנפרד לפי צפיות ומסומן בבירור.
- ייבוא חוזר (`import-creatives.mjs`) שומר `image_source` ופורמט שכבר תועד, גם כשרשומות alias מתמזגות. הרצה בלי `meta/index.json` (ייבוא אורגני בלבד) משאירה את פריטי Meta/Google כמו שהם ולא משנה את סדר ה-Top 10 הממומן.

## קישורי Drive על כרטיסי קריאייטיב (`data/drive-links.json`)

הקובץ ממפה כל כרטיס לשני קישורים אופציונליים, **מסמך אפיון** ו**תסריט Nully**, שמופיעים מתחת לקישור ספריית Meta / הפוסט המקורי (גלריה, רצועות, Top 10, וגם בהגדלה). שדה בלי URL לא מרונדר. קובץ חסר או ריק — ה-build עובר בלי קישורים. אין לשנות מפתחות קיימים; להוסיף רק רשומות חדשות.

```json
{
  "<cardId>": {
    "spec": "https://drive.google.com/...",
    "script": "https://drive.google.com/..."
  }
}
```

- המפתח = `items[].id` ב-`data/creatives.json` (גם `data-id` על הכרטיס, ואותו ערך ב-`data/top10.json`). דוגמה: `meta-1287638459563997`.
- `spec` → «מסמך אפיון». `script` → «תסריט Nully». כל שדה אופציונלי. רק `http://` / `https://`.
- אם שדה חסר בקובץ, `spec_url` / `script_url` על רשומת הכרטיס ממלאים אותו. URL תקין בקובץ גובר.
- צורת ה-id (`scripts/import-creatives.mjs`): `{source}-{slug}` כאשר `source` הוא `meta` | `tiktok` | `organic` | `google`. ל-Meta/Google יש `library_id` (`google-cr…`). ל-TikTok/אורגני בדרך כלל `{source}-{brand}-{8 תווי md5}` — לא המספר שב-URL, ולא המפתח ב-`data/specs.json`.

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

## קישורים חיצוניים
ה-build מריץ `fixLinks` (`scripts/fix-external-links.mjs`) על כל דף ב-`dist/`: כל קישור http(s) חיצוני מקבל `target="_blank" rel="noopener noreferrer"`, וקישורי ספריית המודעות של Meta מנורמלים ל-`https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&id=<id>&media_type=all`. לתיקון קבצי מקור: `node scripts/fix-external-links.mjs <folder> [...]` (בטוח להרצה חוזרת).

## מוסכמת שמות לקבצי Drive של הבוטים

תבנית (סוג המסמך תמיד ראשון):

    <אפיון | תסריט ל-Nully> | <מותג> | <סוג> | <נושא/הוק ב-3–6 מילים> | <ציון>

- **סוג מסמך**: `אפיון` (אפיון מודעה / סרטון / ניתוח מייל) או `תסריט ל-Nully`. צילומי מסך: `צילום מסך`.
- **מותג**: GOOM, By Harmony, EcoSupp, Fill It, Mayven, Mycolivia, Mycospring, Wonders Teva, Tevakid.
- **מותגי רפרנס** (לא נישה): Smiley, try-pups.
- **סוג**: `מודעת תמונה Meta` / `סרטון Meta` / `סרטון TikTok` / `מייל`.
- **נושא/הוק**: 3–6 מילים, לקוח מתוכן המסמך עצמו (כותרת/הוק/טקסט ראשי). לא להמציא.
- **ציון**: המספר בלבד, מתוך "ציון חוזק" במסמך (למשל `7` או `6.5`). תסריט Nully מקבל את ציון האפיון של אותו סרטון.
- אסור `/` בשם (Drive). להשתמש ב-`–` או ברווח.
- גרסה שהוחלפה: קידומת `[גרסה ישנה] ` (למשל `[גרסה ישנה] אפיון | ...`).
- אם יש שני שמות זהים – להוסיף בסוף בסוגריים את מזהה המודעה, למשל `(3167033313596218)`.
- בלי סיומת קובץ (לא `.html`) – השם מסתיים בציון. (עודכן 2026-10-12) שינוי שם בלבד – לא להזיז ולא למחוק; מזהה הקובץ נשמר.

דוגמאות:

    אפיון | GOOM | סרטון TikTok | הייתי סקפטית, אבל בדקתי – פודקאסט | 7
    תסריט ל-Nully | Wonders Teva | סרטון TikTok | צחצוח הוא לא הפתרון – VSL | 8
    אפיון | Mayven | מודעת תמונה Meta | עצר את הנשירה וגם טעים | 7
    אפיון | EcoSupp | מייל | איך הגוף עובד בזמן השינה | 8

### תיקיית 'תסריטים' (עותקים) – פורמט שם נפרד, הדירוג מיד אחרי 'תסריט' (עודכן 2026-10-12)

    תסריט | <דירוג A/B/C> | <מותג מתחרה> | <הוק/CTA/נושא> | <קונספט במילה אחת>

- דירוג: A אם ציון האפיון > 8.5, ‏B אם 6.5–8.5, ‏C אחרת.
- קונספט (מתוך האפיון): ותיקה (מודעה ממומנת שרצה זמן רב) / חדשה (ממומנת חדשה או בבדיקה) / אורגנית (פוסט אורגני).
- בלי 'ל-Nully', בלי סוג סרטון, בלי סיומת. הכלל חל רק על העותקים בתיקיית 'תסריטים'; המקורות בתיקיות הבוטים נשארים בפורמט הרגיל.

    תסריט | B | Tevakid | הסוד של אמהות לילדים עם קשב | ותיקה
