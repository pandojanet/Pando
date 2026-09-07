import { readFileSync, writeFileSync } from "node:fs";
const p = "components/ui/Screen.tsx";
let s = readFileSync(p, "utf8");
const old = "export function SkipLink({ href = \"#main\" }: { href?: string }) {";
const nw = ` * "Skip to the questions" was the first wording and was true on exactly one of
 * the flow's five surfaces: \`/join\` asks for a number, \`/share\` is a message
 * thread, \`/done*\` is three screens of thank-you and \`/signin\` is a code box.
 * A skip link names where it lands, so it names the content.
 */
${old}`;
if (!s.includes(old)) throw new Error("a1");
s = s.replace(old, () => nw);
s = s.replace(" */\n * \"Skip to the questions\"", () => " *\n * \"Skip to the questions\"");
if (!s.includes("      Skip to the questions\n")) throw new Error("a2");
s = s.replace("      Skip to the questions\n", () => "      Skip to the content\n");
writeFileSync(p, s);
console.log("ok");
