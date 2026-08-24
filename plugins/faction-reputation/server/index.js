import makeUpdateFactionReputation from "../tools/update-faction-reputation.js";

/** @param {import('@covel/runtime').PluginAPI} covel */
export default function registerFactionReputation(covel) {
  covel.registerTool(makeUpdateFactionReputation(covel.toolkit));
}
