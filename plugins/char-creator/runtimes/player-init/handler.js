import { pickLocaleText as pick } from "@covel/plugin-handlers-utils";

const CATEGORY_PRIORITY = {
  bio: 0,
  abilities: 1,
  social: 2,
  equipment: 3,
  stats: 4,
};

/**
 * Deterministic setup form for the player character.
 *
 * The previous agent runtime spent an LLM call to translate an already
 * structured character schema into form fields. A transient provider failure
 * therefore blocked session setup before the player could do anything. This
 * handler performs that mechanical projection locally; guard.js still owns the
 * submitted-form -> CharacterRecord transition on the following execution.
 *
 * @param {import('@covel/plugin-loader').FunctionHandlerContext} ctx
 * @returns {Promise<Record<string, unknown>>}
 */
export default async function playerInitHandler(ctx) {
  const locale = ctx.locale;
  const schema = characterSchemaFromInput(ctx.inputs?.worldSchema?.value);
  const attributes = Array.isArray(schema?.attributes) ? schema.attributes : [];
  const selectedAttributes = attributes
    .map((attribute, index) => ({ attribute, index }))
    .filter(({ attribute }) => isFormAttribute(attribute))
    .sort(
      (left, right) =>
        categoryPriority(left.attribute.category) -
          categoryPriority(right.attribute.category) ||
        left.index - right.index,
    )
    .slice(0, 3)
    .map(({ attribute }) => attribute);

  const fields = [
    {
      type: "text",
      name: "characterName",
      label: pick(locale, "角色姓名", "Character name"),
      placeholder: pick(locale, "输入你的名字", "Enter your name"),
      required: true,
    },
    ...selectedAttributes.map((attribute) => formField(attribute, locale)),
  ];
  const opening = textFromInput(ctx.inputs?.opening?.value);
  const narrativeTemplate = buildNarrativeTemplate(fields, opening, locale);

  return {
    outcome: "success",
    value: {
      narrativeOutput: "",
      preGameDone: false,
    },
    effects: {
      interactions: [
        {
          type: "form",
          interactionId: "char-creation",
          title: pick(locale, "塑造你的角色", "Create your character"),
          fields,
          submitLabel: pick(locale, "踏入雾中", "Begin the adventure"),
          narrativeTemplate,
          submitBehavior: {
            echoFilledNarrative: true,
            immediate: true,
          },
        },
      ],
    },
  };
}

function characterSchemaFromInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = /** @type {Record<string, unknown>} */ (value);
  const nested = record["character-attributes"];
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return /** @type {Record<string, any>} */ (nested);
  }
  return Array.isArray(record.attributes)
    ? /** @type {Record<string, any>} */ (record)
    : null;
}

function isFormAttribute(attribute) {
  if (!attribute || typeof attribute !== "object") return false;
  if (typeof attribute.id !== "string" || !attribute.id) return false;
  if (attribute.id === "characterName") return false;
  if (attribute.type === "number" && attribute.category === "stats")
    return false;
  return ["string", "number", "boolean", "enum", "array"].includes(
    attribute.type,
  );
}

function categoryPriority(category) {
  return CATEGORY_PRIORITY[category] ?? Number.MAX_SAFE_INTEGER;
}

function formField(attribute, locale) {
  const type = attribute.type;
  const label = localizedText(attribute.name, locale, attribute.id);
  const description = localizedText(attribute.description, locale, "");
  if (type === "enum") {
    return {
      type: "select",
      name: attribute.id,
      label,
      options:
        Array.isArray(attribute.options) && attribute.options.length > 0
          ? attribute.options.map(String)
          : [pick(locale, "未指定", "Unspecified")],
      required: false,
    };
  }
  if (type === "number") {
    return {
      type: "select",
      name: attribute.id,
      label,
      options: numericOptions(attribute),
      required: false,
    };
  }
  if (type === "boolean") {
    return {
      type: "checkbox",
      name: attribute.id,
      label,
      required: false,
    };
  }
  return {
    type: type === "array" ? "textarea" : "text",
    name: attribute.id,
    label,
    ...(description ? { placeholder: description } : {}),
    required: false,
  };
}

function numericOptions(attribute) {
  const min = Number.isFinite(attribute.min) ? Math.ceil(attribute.min) : 0;
  const max = Number.isFinite(attribute.max)
    ? Math.floor(attribute.max)
    : Math.max(min + 4, Number(attribute.defaultValue) || 4);
  if (max <= min) return [String(min)];
  const step = Math.max(1, Math.floor((max - min) / 4));
  const values = [];
  for (let value = min; value <= max && values.length < 5; value += step) {
    values.push(String(value));
  }
  if (values.at(-1) !== String(max)) values.push(String(max));
  return [...new Set(values)].slice(0, 5);
}

function localizedText(value, locale, fallback) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }
  const record = /** @type {Record<string, unknown>} */ (value);
  const preferred = String(locale ?? "").startsWith("zh")
    ? [record["zh-CN"], record.zh, record["en-US"], record.en]
    : [record["en-US"], record.en, record["zh-CN"], record.zh];
  return (
    preferred.find((entry) => typeof entry === "string" && entry.trim()) ??
    fallback
  );
}

function buildNarrativeTemplate(fields, opening, locale) {
  const clauses = fields
    .slice(1)
    .map((field) =>
      pick(
        locale,
        `${field.label}是 {{${field.name}}}`,
        `${field.label} is {{${field.name}}}`,
      ),
    );
  const identity = pick(
    locale,
    `你以 {{characterName}} 之名醒来`,
    `You enter the story as {{characterName}}`,
  );
  const details = clauses.length > 0 ? `，${clauses.join("，")}` : "";
  const setting = opening
    ? pick(
        locale,
        "。眼前的世界正等待你的选择。",
        ". The world awaits your choice.",
      )
    : pick(locale, "。冒险由此开始。", ". Your adventure begins here.");
  return `${identity}${details}${setting}`;
}

function textFromInput(value) {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const narrative = value.narrativeOutput;
  return typeof narrative === "string" ? narrative.trim() : "";
}
