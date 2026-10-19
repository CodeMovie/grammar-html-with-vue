/* Hand-written tokenizers for HTML. */

import {ExternalTokenizer, ContextTracker} from "@lezer/lr"
import {StartTag, StartCloseTag, NoMatchStartCloseTag, MismatchedStartCloseTag, missingCloseTag,
        StartSelfClosingTag, IncompleteCloseTag, Element, OpenTag, IncompleteTag,
        Component, OpenComponentTag,
        StartScriptTag, scriptText, StartCloseScriptTag,
        StartStyleTag, styleText, StartCloseStyleTag,
        StartTextareaTag, textareaText, StartCloseTextareaTag,
        StartComponent, StartEndComponent, NoMatchStartEndComponent, MismatchedStartEndComponent,
        Dialect_noMatch, Dialect_selfClosing, Dialect_vue, Dialect_specialComponent, EndTag, EndComponent, SelfClosingEndTag,
        Text, InterpolationStart, InterpolationContent, InterpolationEnd,
        commentContent as cmntContent} from "./parser.terms.js"

const selfClosers = {
  area: true, base: true, br: true, col: true, command: true,
  embed: true, frame: true, hr: true, img: true, input: true,
  keygen: true, link: true, meta: true, param: true, source: true,
  track: true, wbr: true, menuitem: true
}

const implicitlyClosed = {
  dd: true, li: true, optgroup: true, option: true, p: true,
  rp: true, rt: true, tbody: true, td: true, tfoot: true,
  th: true, tr: true
}

const closeOnOpen = {
  dd: {dd: true, dt: true},
  dt: {dd: true, dt: true},
  li: {li: true},
  option: {option: true, optgroup: true},
  optgroup: {optgroup: true},
  p: {
    address: true, article: true, aside: true, blockquote: true, dir: true,
    div: true, dl: true, fieldset: true, footer: true, form: true,
    h1: true, h2: true, h3: true, h4: true, h5: true, h6: true,
    header: true, hgroup: true, hr: true, menu: true, nav: true, ol: true,
    p: true, pre: true, section: true, table: true, ul: true
  },
  rp: {rp: true, rt: true},
  rt: {rp: true, rt: true},
  tbody: {tbody: true, tfoot: true},
  td: {td: true, th: true},
  tfoot: {tbody: true},
  th: {td: true, th: true},
  thead: {tbody: true, tfoot: true},
  tr: {tr: true}
}

function nameChar(ch) {
  return ch == 45 || ch == 46 || ch == 58 || ch >= 65 && ch <= 90 || ch == 95 || ch >= 97 && ch <= 122 || ch >= 161
}

function isSpace(ch) {
  return ch == 9 || ch == 10 || ch == 13 || ch == 32
}

const hyphenatedBuiltIns = [
  "annotation-xml", "color-profile", "font-face", "font-face-src",
  "font-face-uri", "font-face-format", "font-face-name", "missing-glyph"
]

function isComponent(name, stack) {
  if (!stack.dialectEnabled(Dialect_specialComponent)) return false
  let first = name.charCodeAt(0)
  return first >= 65 && first <= 90 && /[a-z]/.test(name) ||
    name.indexOf("-", 1) > 0 && !hyphenatedBuiltIns.includes(name.toLowerCase())
}

let cachedName = null, cachedInput = null, cachedPos = 0
function tagNameAfter(input, offset) {
  let pos = input.pos + offset
  if (cachedPos == pos && cachedInput == input) return cachedName
  let next = input.peek(offset), name = ""
  for (;;) {
    if (!nameChar(next)) break
    name += String.fromCharCode(next)
    next = input.peek(++offset)
  }
  // Undefined to signal there's a <? or <!, null for just missing
  cachedInput = input; cachedPos = pos
  return cachedName = name ? name : next == question || next == bang ? undefined : null
}

function elementName(name, stack) {
  return name && !isComponent(name, stack) ? name.toLowerCase() : name
}

const lessThan = 60, greaterThan = 62, slash = 47, question = 63, bang = 33, dash = 45

function ElementContext(name, parent) {
  this.name = name
  this.parent = parent
}

const startTagTerms = [StartTag, StartSelfClosingTag, StartScriptTag, StartStyleTag, StartTextareaTag, StartComponent]

export const elementContext = new ContextTracker({
  start: null,
  shift(context, term, stack, input) {
    return startTagTerms.indexOf(term) > -1 ? new ElementContext(elementName(tagNameAfter(input, 1), stack) || "", context) : context
  },
  reduce(context, term) {
    return (term == Element || term == Component) && context ? context.parent : context
  },
  reuse(context, node, stack, input) {
    let type = node.type.id
    return type == StartTag || type == StartComponent || type == OpenTag || type == OpenComponentTag
      ? new ElementContext(elementName(tagNameAfter(input, 1), stack) || "", context) : context
  },
  strict: false
})

export const tagStart = new ExternalTokenizer((input, stack) => {
  if (input.next != lessThan) {
    // End of file, close any open tags
    if (input.next < 0 && stack.context) input.acceptToken(missingCloseTag)
    return
  }
  input.advance()
  let close = input.next == slash
  if (close) input.advance()
  let name = tagNameAfter(input, 0)
  if (name === undefined) return
  if (!name) return input.acceptToken(close ? IncompleteCloseTag : IncompleteTag)

  let component = isComponent(name, stack)
  if (!component) name = name.toLowerCase()
  let parent = stack.context ? stack.context.name : null
  if (close) {
    if (name == parent) return input.acceptToken(component ? StartEndComponent : StartCloseTag)
    if (parent && implicitlyClosed[parent]) return input.acceptToken(missingCloseTag, -2)
    if (stack.dialectEnabled(Dialect_noMatch))
      return input.acceptToken(component ? NoMatchStartEndComponent : NoMatchStartCloseTag)
    for (let cx = stack.context; cx; cx = cx.parent) if (cx.name == name) return
    input.acceptToken(component ? MismatchedStartEndComponent : MismatchedStartCloseTag)
  } else if (component) {
    input.acceptToken(StartComponent)
  } else {
    if (name == "script") return input.acceptToken(StartScriptTag)
    if (name == "style") return input.acceptToken(StartStyleTag)
    if (name == "textarea") return input.acceptToken(StartTextareaTag)
    if (selfClosers.hasOwnProperty(name)) return input.acceptToken(StartSelfClosingTag)
    if (parent && closeOnOpen[parent] && closeOnOpen[parent][name]) input.acceptToken(missingCloseTag, -1)
    else input.acceptToken(StartTag)
  }
}, {contextual: true})

export const commentContent = new ExternalTokenizer(input => {
  for (let dashes = 0, i = 0;; i++) {
    if (input.next < 0) {
      if (i) input.acceptToken(cmntContent)
      break
    }
    if (input.next == dash) {
      dashes++
    } else if (input.next == greaterThan && dashes >= 2) {
      if (i >= 3) input.acceptToken(cmntContent, -2)
      break
    } else {
      dashes = 0
    }
    input.advance()
  }
})

function inForeignElement(context) {
  for (; context; context = context.parent)
    if (context.name == "svg" || context.name == "math") return true
  return false
}

export const endTag = new ExternalTokenizer((input, stack) => {
  if (input.next == slash && input.peek(1) == greaterThan) {
    let selfClosing = stack.dialectEnabled(Dialect_selfClosing) || inForeignElement(stack.context)
    input.acceptToken(selfClosing ? SelfClosingEndTag : stack.canShift(EndComponent) ? EndComponent : EndTag, 2)
  } else if (input.next == greaterThan) {
    input.acceptToken(stack.canShift(EndComponent) ? EndComponent : EndTag, 1)
  }
})

function contentTokenizer(tag, textToken, endToken) {
  let lastState = 2 + tag.length
  return new ExternalTokenizer(input => {
    // state means:
    // - 0 nothing matched
    // - 1 '<' matched
    // - 2 '</'
    // - 3-(1+tag.length) part of the tag matched
    // - lastState whole tag + possibly whitespace matched
    for (let state = 0, matchedLen = 0, i = 0;; i++) {
      if (input.next < 0) {
        if (i) input.acceptToken(textToken)
        break
      }
      if (state == 0 && input.next == lessThan ||
          state == 1 && input.next == slash ||
          state >= 2 && state < lastState && input.next == tag.charCodeAt(state - 2)) {
        state++
        matchedLen++
      } else if (state == lastState && input.next == greaterThan) {
        if (i > matchedLen)
          input.acceptToken(textToken, -matchedLen)
        else
          input.acceptToken(endToken, -(matchedLen - 2))
        break
      } else if ((input.next == 10 || input.next == 13) && i) {
        input.acceptToken(textToken, 1)
        break
      } else {
        state = matchedLen = 0
      }
      input.advance()
    }
  })
}

export const scriptTokens = contentTokenizer("script", scriptText, StartCloseScriptTag)

export const styleTokens = contentTokenizer("style", styleText, StartCloseStyleTag)

export const textareaTokens = contentTokenizer("textarea", textareaText, StartCloseTextareaTag)

const ampersand = 38, braceL = 123, braceR = 125, dollar = 36, backslash = 92,
      quoteDouble = 34, quoteSingle = 39, backtick = 96, star = 42,
      bracketL = 91, bracketR = 93, parenR = 41, newline = 10, carriageReturn = 13

function isWordChar(ch) {
  return ch >= 48 && ch <= 57 || ch >= 65 && ch <= 90 || ch >= 97 && ch <= 122 ||
    ch == 95 || ch == dollar || ch >= 128
}

function isDigit(ch) {
  return ch >= 48 && ch <= 57
}

// Words after which a slash starts a regular expression rather than
// a division.
const regexpKeywords = {
  typeof: true, instanceof: true, in: true, of: true, new: true, delete: true,
  void: true, await: true, yield: true, return: true, case: true, do: true, else: true
}

function scanInterpolation(input, offset) {
  // Stack of open braces. `true` marks a template literal `${`.
  let braces = [], regexpAllowed = true
  for (let pos = offset;;) {
    let next = input.peek(pos)
    if (next < 0) return -1
    if (next == braceR) {
      if (!braces.length) {
        if (input.peek(pos + 1) == braceR) return pos
        pos++
      } else if (braces.pop()) {
        pos = scanTemplate(input, pos + 1, braces)
      } else {
        pos++
      }
      regexpAllowed = false
    } else if (next == braceL) {
      braces.push(false)
      pos++
      regexpAllowed = true
    } else if (next == quoteDouble || next == quoteSingle) {
      pos = scanString(input, pos + 1, next)
      regexpAllowed = false
    } else if (next == backtick) {
      pos = scanTemplate(input, pos + 1, braces)
      regexpAllowed = false
    } else if (next == slash && input.peek(pos + 1) == slash) {
      // Line comment. Also ends before a closing `}}` so that
      // `{{ a // note }}` works on a single line.
      for (pos += 2;; pos++) {
        let ch = input.peek(pos)
        if (ch < 0 || ch == newline || ch == carriageReturn ||
            !braces.length && ch == braceR && input.peek(pos + 1) == braceR) break
      }
    } else if (next == slash && input.peek(pos + 1) == star) {
      for (pos += 2;; pos++) {
        let ch = input.peek(pos)
        if (ch < 0) return -1
        if (ch == star && input.peek(pos + 1) == slash) { pos += 2; break }
      }
    } else if (next == slash && regexpAllowed) {
      pos = scanRegexp(input, pos + 1)
      regexpAllowed = false
    } else if (isWordChar(next)) {
      let word = ""
      for (; isWordChar(input.peek(pos)); pos++) word += String.fromCharCode(input.peek(pos))
      regexpAllowed = !isDigit(word.charCodeAt(0)) && regexpKeywords.hasOwnProperty(word)
    } else {
      if (!isSpace(next)) regexpAllowed = next != parenR && next != bracketR
      pos++
    }
  }
}

function scanString(input, pos, quote) {
  for (;; pos++) {
    let ch = input.peek(pos)
    if (ch < 0 || ch == newline || ch == carriageReturn) return pos
    if (ch == quote) return pos + 1
    if (ch == backslash) pos++
  }
}

function scanTemplate(input, pos, braces) {
  for (;; pos++) {
    let ch = input.peek(pos)
    if (ch < 0) return pos
    if (ch == backtick) return pos + 1
    if (ch == backslash) pos++
    else if (ch == dollar && input.peek(pos + 1) == braceL) {
      braces.push(true)
      return pos + 2
    }
  }
}

function scanRegexp(input, pos) {
  for (let inClass = false;; pos++) {
    let ch = input.peek(pos)
    if (ch < 0 || ch == newline || ch == carriageReturn) return pos
    if (ch == backslash) pos++
    else if (ch == bracketL) inClass = true
    else if (ch == bracketR) inClass = false
    else if (ch == slash && !inClass) return pos + 1
  }
}

let cachedScanInput = null, cachedScanPos = -1, cachedScanEnd = -1
// Returns the offset of the closing `}}` for an expression starting
// at `offset`, or -1.
function interpolationEnd(input, offset) {
  let pos = input.pos + offset
  if (cachedScanInput != input || cachedScanPos != pos) {
    cachedScanInput = input; cachedScanPos = pos
    cachedScanEnd = scanInterpolation(input, offset)
    if (cachedScanEnd >= 0) cachedScanEnd -= offset
  }
  return cachedScanEnd < 0 ? -1 : cachedScanEnd + offset
}

// Tokenizes text content and, in the vue dialect, `{{ }}`
// interpolations. An opening `{{` without a matching `}}` is treated
// as text.
export const textTokens = new ExternalTokenizer((input, stack) => {
  let vue = stack.dialectEnabled(Dialect_vue)
  if (vue) {
    if (stack.canShift(InterpolationContent)) {
      let end = interpolationEnd(input, 0)
      if (end > 0) return input.acceptToken(InterpolationContent, end)
    }
    if (input.next == braceR && input.peek(1) == braceR && stack.canShift(InterpolationEnd))
      return input.acceptToken(InterpolationEnd, 2)
    if (input.next == braceL && input.peek(1) == braceL && stack.canShift(InterpolationStart) &&
        interpolationEnd(input, 2) >= 0)
      return input.acceptToken(InterpolationStart, 2)
  }
  if (!stack.canShift(Text)) return
  for (let i = 0;; i++) {
    let next = input.next
    if (next < 0 || next == lessThan || next == ampersand ||
        vue && i > 0 && next == braceL && input.peek(1) == braceL && interpolationEnd(input, 2) >= 0) {
      if (i) input.acceptToken(Text)
      return
    }
    input.advance()
  }
})
