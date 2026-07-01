import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml } from './htmlEscape';

describe('escapeHtml — email-template interpolation safety', () => {
  it('escapes every markup-significant character', () => {
    assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
  });

  it('neutralizes a typical injection payload', () => {
    const out = escapeHtml('<img src=x onerror=alert(1)>');
    assert.equal(out.includes('<'), false);
    assert.equal(out.includes('>'), false);
  });

  it('passes plain text through unchanged', () => {
    assert.equal(
      escapeHtml('Grok moderated the request (HTTP 400)'),
      'Grok moderated the request (HTTP 400)',
    );
  });

  it('coerces non-string input safely', () => {
    assert.equal(escapeHtml(42), '42');
    assert.equal(escapeHtml(null), 'null');
    assert.equal(escapeHtml(undefined), 'undefined');
  });
});
