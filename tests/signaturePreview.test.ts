import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SignaturePreview } from '../src/components/schulamt/SignaturePreview';

test('saved signatures load directly with the browser session instead of the image optimizer', () => {
  const source = '/api/media/private-signature.png';
  const html = renderToStaticMarkup(createElement(SignaturePreview, { source }));
  assert.match(html, /src="\/api\/media\/private-signature\.png"/);
  assert.doesNotMatch(html, /_next\/image|srcSet=/);
  assert.match(html, /alt="Unterschrift Vorschau"/);
});

test('a new local signature never falls back to its not-yet-saved private URL', () => {
  const html = renderToStaticMarkup(createElement(SignaturePreview, {
    source: '/api/media/not-saved.png',
    file: new File(['image'], 'signature.png', { type: 'image/png' }),
  }));
  assert.match(html, /role="status"/);
  assert.doesNotMatch(html, /<img|not-saved\.png|_next\/image/);
});
