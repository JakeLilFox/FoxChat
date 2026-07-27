import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import go from 'highlight.js/lib/languages/go'
import graphql from 'highlight.js/lib/languages/graphql'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import lua from 'highlight.js/lib/languages/lua'
import markdown from 'highlight.js/lib/languages/markdown'
import php from 'highlight.js/lib/languages/php'
import powershell from 'highlight.js/lib/languages/powershell'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

const languages = {
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  dockerfile,
  go,
  graphql,
  ini,
  java,
  javascript,
  json,
  kotlin,
  lua,
  markdown,
  php,
  powershell,
  python,
  ruby,
  rust,
  sql,
  swift,
  typescript,
  xml,
  yaml,
}

for (const [name, language] of Object.entries(languages)) {
  hljs.registerLanguage(name, language)
}

const aliases: Record<string, keyof typeof languages> = {
  'c#': 'csharp',
  cs: 'csharp',
  dotnet: 'csharp',
  'c++': 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  rs: 'rust',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  rb: 'ruby',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  ps1: 'powershell',
  html: 'xml',
  svg: 'xml',
  vue: 'xml',
  yml: 'yaml',
  md: 'markdown',
  docker: 'dockerfile',
  toml: 'ini',
  text: 'ini',
  txt: 'ini',
}

const labels: Record<string, string> = {
  cpp: 'C++',
  csharp: 'C#',
  css: 'CSS',
  dockerfile: 'Dockerfile',
  graphql: 'GraphQL',
  html: 'HTML',
  ini: 'INI / TOML',
  java: 'Java',
  javascript: 'JavaScript',
  json: 'JSON',
  kotlin: 'Kotlin',
  markdown: 'Markdown',
  php: 'PHP',
  powershell: 'PowerShell',
  python: 'Python',
  rust: 'Rust',
  sql: 'SQL',
  svg: 'SVG',
  typescript: 'TypeScript',
  xml: 'XML',
  yaml: 'YAML',
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export type HighlightedCode = {
  code: string
  html: string
  language: string
  label: string
  jsonViewer: boolean
}

export function highlightCode(source: string, requestedLanguage?: string): HighlightedCode {
  const requested = requestedLanguage?.trim().toLowerCase() || ''
  const canonical = aliases[requested] ?? requested
  const language = hljs.getLanguage(canonical) ? canonical : ''
  let code = source
  let jsonViewer = false

  if (language === 'json') {
    // Accept mismatched legacy JSON fences.
    code = source.replace(/\r?\n[ \t]{0,3}`{3,}[ \t]*$/, '')
    try {
      code = JSON.stringify(JSON.parse(code), null, 2)
      jsonViewer = true
    } catch {}
  }

  let html = escapeHtml(code)
  if (language) {
    try {
      html = hljs.highlight(code, {
        language,
        ignoreIllegals: true,
      }).value
    } catch {}
  }

  return {
    code,
    html,
    language: language || 'code',
    label: labels[requested] ?? labels[canonical] ?? (requested ? requested.toUpperCase() : 'Code'),
    jsonViewer,
  }
}
