import {styleTags, tags as t} from "@lezer/highlight"

export const htmlHighlighting = styleTags({
  "Text RawText IncompleteTag IncompleteCloseTag": t.content,
  "StartTag StartCloseTag SelfClosingEndTag EndTag StartComponent StartEndComponent EndComponent": t.angleBracket,
  "InterpolationStart InterpolationEnd": t.brace,
  "TagName ComponentTag": t.tagName,
  "MismatchedCloseTag/TagName MismatchedCloseTag/ComponentTag": [t.tagName,  t.invalid],
  AttributeName: t.attributeName,
  "AttributeValue UnquotedAttributeValue": t.attributeValue,
  Is: t.definitionOperator,
  "EntityReference CharacterReference": t.character,
  Comment: t.blockComment,
  ProcessingInst: t.processingInstruction,
  DoctypeDecl: t.documentMeta
})
