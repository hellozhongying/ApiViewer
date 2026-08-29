function formatJsonText(value) {
  const source = String(value ?? "");
  JSON.parse(source);

  const text = source.trim();
  let output = "";
  let indent = 0;
  let inString = false;
  let escaped = false;

  const indentation = () => "  ".repeat(indent);
  const nextNonWhitespace = (start) => {
    let index = start;
    while (/\s/.test(text[index] || "")) index += 1;
    return text[index];
  };
  const previousNonWhitespace = (start) => {
    let index = start;
    while (index >= 0 && /\s/.test(text[index])) index -= 1;
    return text[index];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (inString) {
      output += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') {
      inString = true;
      output += character;
    } else if (/\s/.test(character)) {
      continue;
    } else if (character === "{" || character === "[") {
      output += character;
      const closingCharacter = character === "{" ? "}" : "]";
      if (nextNonWhitespace(index + 1) !== closingCharacter) {
        indent += 1;
        output += `\n${indentation()}`;
      }
    } else if (character === "}" || character === "]") {
      const openingCharacter = character === "}" ? "{" : "[";
      if (previousNonWhitespace(index - 1) !== openingCharacter) {
        indent = Math.max(0, indent - 1);
        output += `\n${indentation()}`;
      }
      output += character;
    } else if (character === ",") {
      output += `,\n${indentation()}`;
    } else if (character === ":") {
      output += ": ";
    } else {
      output += character;
    }
  }

  return output;
}

function tryFormatJsonText(value) {
  try {
    return formatJsonText(value);
  } catch {
    return String(value ?? "");
  }
}
