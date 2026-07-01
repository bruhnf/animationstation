// Minimal HTML entity escaping for free-text interpolated into email
// templates (error messages, user-influenced strings). Not a sanitizer — just
// enough to keep markup-significant characters inert in HTML bodies.
export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}
