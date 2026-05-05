// Meridian — operator-surface component barrel.
//
// Stable extractions live here. OperatorConsole.jsx remains monolithic
// for now: most of its inner components share a private `S` style map
// and `callMcp` closure, so extracting them in one pass is high-risk.
// Pull components out one at a time as the styles get hoisted.

export { default as SourceReadinessBar } from "./SourceReadinessBar";
