'use strict';

// Pure helpers turning parsed API entries into completion snippets, hover text and
// signature-help data, so they can be tested without VS Code.

const escapeSnippet = (s) => s.replace(/[\\$}]/g, '\\$&');

// Snippet inserting required parameters only. `skipFirst` drops the object handle for `obj:Method()`.
function snippetFor(fn, skipFirst) {
  const params = fn.params.slice(skipFirst ? 1 : 0).filter((p) => !p.optional && p.name !== '...');
  const args = params.map((p, i) => `\${${i + 1}:${escapeSnippet(p.name)}}`).join(', ');
  return `${fn.name}(${args})`;
}

function hoverMarkdown(fn, kind) {
  const lines = ['```lua', fn.signature, '```'];
  const rows = fn.params.map((p) => `- \`${p.name}\`${p.optional ? ' (optional)' : ''}: ${p.label}`);
  if (rows.length) lines.push('', '**Parameters**', ...rows);
  if (fn.returns && fn.returns !== 'nothing') lines.push('', `**Returns** ${fn.returns}`);
  lines.push('', kind === 'object' ? '_Object API: call as `handle:Name(...)`._' : '_Global function._');
  return lines.join('\n');
}

function buildIndex(api) {
  const global = new Map(api.global.map((f) => [f.name, f]));
  const object = new Map(api.object.map((f) => [f.name, f]));
  return { global, object, api };
}

// Which function call is the cursor inside, and which argument? Looks back over the line text.
function activeCall(rawText) {
  // Blank closed string literals so commas/parens inside them are ignored; an open string means no call.
  const textBeforeCursor = rawText.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, (s) => '_'.repeat(s.length));
  if (/["']/.test(textBeforeCursor)) return null;
  let depth = 0;
  let commas = 0;
  for (let i = textBeforeCursor.length - 1; i >= 0; i--) {
    const ch = textBeforeCursor[i];
    if (ch === ')' || ch === '}' || ch === ']') depth++;
    else if (ch === '(' || ch === '{' || ch === '[') {
      if (depth === 0) {
        if (ch !== '(') return null;
        const name = (textBeforeCursor.slice(0, i).match(/([A-Za-z_]\w*)\s*$/) || [])[1];
        return name ? { name, argIndex: commas } : null;
      }
      depth--;
    } else if (ch === ',' && depth === 0) commas++;
  }
  return null;
}

module.exports = { snippetFor, hoverMarkdown, buildIndex, activeCall };
