import type { DetectionRule } from "../CodeAnalyzer.js";
import { nPlusOneQuery } from "./nPlusOneQuery.js";

/** All detection rules applied by PythonAnalyzer. Add new rules here. */
export const pythonRules: DetectionRule[] = [nPlusOneQuery];
