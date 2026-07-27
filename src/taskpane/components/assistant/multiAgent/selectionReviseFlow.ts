/**
 * Backward-compatible re-exports.
 * Selection revise is now part of the unified local document short path.
 */
export {
  isSelectionReviseTask,
  isLocalDocumentTask,
  runLocalDocumentFlow,
  runSelectionReviseFlow,
  type LocalDocumentTaskKind,
  type RunLocalDocumentFlowParams as RunSelectionReviseParams,
} from "./localDocumentFlow";
