import { TARGETS } from "./src/targets";
const ids = TARGETS.map((t) => t.id);
const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
console.log("Total targets:", TARGETS.length);
console.log("Duplicate ids:", dupes);
