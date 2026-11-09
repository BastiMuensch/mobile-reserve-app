function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// The outbox keeps the readable plain-text source. Rendering at delivery also
// gives queued/legacy messages the same layout without changing their payload.
function renderBody(body: string): string {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const blocks: string[] = [];
  const field = (line: string) => /^([\p{L}][\p{L}\d /().-]{0,50}): (.+)$/u.exec(line);
  const heading = (line: string) => /^[\p{L}][\p{L}\d /().-]{0,70}:$/u.test(line);
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (heading(line)) {
      blocks.push(`<h2 style="margin:24px 0 10px;font-size:16px;line-height:24px;color:#243655;">${escapeHtml(line.slice(0, -1))}</h2>`);
      i++;
    } else if (field(line)) {
      const rows: string[] = [];
      while (i < lines.length) {
        const match = field(lines[i]);
        if (!match) break;
        rows.push(`<tr><td style="padding:10px 14px;border-bottom:1px solid #e4eaf2;overflow-wrap:anywhere;word-break:break-word;"><span style="display:block;font-size:12px;line-height:18px;color:#52627a;">${escapeHtml(match[1])}</span><strong style="font-size:15px;line-height:23px;font-weight:600;color:#182b49;">${escapeHtml(match[2])}</strong></td></tr>`);
        i++;
      }
      blocks.push(`<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;table-layout:fixed;border:1px solid #e4eaf2;border-radius:8px;background-color:#f5f7fb;margin:0 0 18px;">${rows.join('')}</table>`);
    } else if (line.startsWith('- ')) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith('- ')) {
        items.push(`<li style="padding:8px 0;border-bottom:1px solid #e4eaf2;">${escapeHtml(lines[i++].slice(2))}</li>`);
      }
      blocks.push(`<ul style="margin:0 0 20px;padding-left:22px;">${items.join('')}</ul>`);
    } else {
      const paragraph: string[] = [];
      do {
        const value = lines[i++];
        // Only explicit, whole-line HTTP(S) URLs become links. All other text,
        // including comments and HTML-looking input, remains escaped text.
        let url: URL | undefined;
        try { url = new URL(value); } catch { /* Plain text. */ }
        paragraph.push(url && /^https?:$/.test(url.protocol) && !/\s/.test(value)
          ? `<a href="${escapeHtml(url.href)}" style="color:#3730a3;text-decoration:underline;overflow-wrap:anywhere;word-break:break-all;">${escapeHtml(value)}</a>`
          : escapeHtml(value));
      } while (i < lines.length && lines[i].trim() && !heading(lines[i]) && !field(lines[i]) && !lines[i].startsWith('- '));
      blocks.push(`<p style="margin:0 0 18px;">${paragraph.join('<br>')}</p>`);
    }
  }
  return blocks.join('\n');
}

/** No remote images/fonts; inline styles and tables work without CSS support. */
export function renderEmailHtml(subject: string, body: string): string {
  const title = escapeHtml(subject);
  const preview = escapeHtml(body.replace(/\s+/g, ' ').trim().slice(0, 180));
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head>
<body style="margin:0;padding:0;background-color:#edf1f7;color:#263650;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;">
<div aria-hidden="true" style="display:none;font-size:1px;color:#edf1f7;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${preview}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#edf1f7;"><tr><td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" width="600" cellspacing="0" cellpadding="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;table-layout:fixed;background-color:#ffffff;border:1px solid #dce3ee;border-radius:12px;">
<tr><td style="padding:22px 24px;background-color:#283655;border-radius:12px 12px 0 0;color:#ffffff;border-bottom:4px solid #a5b4fc;"><span style="font-size:18px;font-weight:bold;letter-spacing:0.2px;">Mobile Reserven</span><br><span style="font-size:12px;line-height:20px;color:#dce4f5;">Information zu Ihrer Vertretungsplanung</span></td></tr>
<tr><td style="padding:26px 24px 12px;overflow-wrap:anywhere;word-break:break-word;"><h1 style="margin:0 0 22px;font-size:24px;line-height:32px;font-weight:700;color:#182b49;">${title}</h1>${renderBody(body)}</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #e4eaf2;color:#52627a;font-size:12px;line-height:19px;">Automatische Benachrichtigung · Mobile Reserven<br>Den aktuellen Stand finden Sie in Ihrem Portal.</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
}
