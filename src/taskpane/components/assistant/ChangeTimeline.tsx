import * as React from "react";
import { Button, Spinner, Text, mergeClasses } from "@fluentui/react-components";
import {
  ArrowUndo24Regular,
  ChevronDown24Regular,
  ChevronUp24Regular,
  History24Regular,
} from "@fluentui/react-icons";
import type { EditRollbackPreview, EditTransaction } from "../../../utils/editTransactionTypes";
import { useStyles } from "./styles";

export interface ChangeTimelineProps {
  open: boolean;
  transactions: EditTransaction[];
  loading: boolean;
  selectedPreview: EditRollbackPreview | null;
  previewingTransactionId?: string;
  onToggleOpen: (open: boolean) => void;
  onRefresh: () => Promise<void>;
  onPreviewRollback: (transactionId: string) => Promise<void>;
  onRollbackTransaction: (transactionId: string) => Promise<void>;
  onRollbackGroup: (operationGroupId: string) => Promise<void>;
}

function formatTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function statusLabel(status: EditTransaction["status"]): string {
  const map: Record<EditTransaction["status"], string> = {
    planned: "已计划",
    previewed: "已预览",
    committing: "提交中",
    committed: "已提交",
    verifying: "校验中",
    rolling_back: "撤回中",
    rolled_back: "已撤回",
    failed: "失败",
    blocked_target_changed: "已阻断",
    unknown_commit_state: "提交未知",
  };
  return map[status] || status;
}

function operationLabel(transaction: EditTransaction): string {
  if (transaction.rollbackOf) return `撤回 ${transaction.rollbackOf}`;
  return transaction.preview?.title || transaction.operation.type;
}

function targetLabel(transaction: EditTransaction): string {
  if (transaction.scope.kind === "paragraph_range") {
    return `第 ${transaction.scope.startParagraphIndex}-${transaction.scope.endParagraphIndex} 段`;
  }
  if (transaction.scope.kind === "selection") return "选区";
  if (transaction.scope.kind === "cursor") return transaction.scope.location || "光标";
  if (transaction.scope.kind === "paragraph_anchor") {
    return typeof transaction.scope.anchorParagraphIndex === "number"
      ? `锚点 ${transaction.scope.anchorParagraphIndex}`
      : "锚点";
  }
  return "文档";
}

export const ChangeTimeline: React.FC<ChangeTimelineProps> = ({
  open,
  transactions,
  loading,
  selectedPreview,
  previewingTransactionId,
  onToggleOpen,
  onRefresh,
  onPreviewRollback,
  onRollbackTransaction,
  onRollbackGroup,
}) => {
  const styles = useStyles();
  const groups = React.useMemo(() => {
    const seen = new Set<string>();
    return transactions
      .map((item) => item.operationGroupId)
      .filter((item): item is string => Boolean(item?.trim()))
      .filter((item) => {
        if (seen.has(item)) return false;
        seen.add(item);
        return true;
      });
  }, [transactions]);

  return (
    <div className={styles.changeTimelinePanel}>
      <div className={styles.changeTimelineHeader}>
        <div className={styles.changeTimelineTitleRow}>
          <History24Regular className={styles.changeTimelineIcon} aria-hidden />
          <Text className={styles.changeTimelineTitle}>变更记录</Text>
          <Text className={styles.changeTimelineMeta}>{transactions.length} 项</Text>
        </div>
        <div className={styles.changeTimelineActions}>
          {open && (
            <Button appearance="subtle" size="small" onClick={() => { void onRefresh(); }}>
              刷新
            </Button>
          )}
          <Button
            appearance="subtle"
            size="small"
            icon={open ? <ChevronDown24Regular /> : <ChevronUp24Regular />}
            onClick={() => onToggleOpen(!open)}
          >
            {open ? "收起" : "查看"}
          </Button>
        </div>
      </div>

      {open && (
        <div className={styles.changeTimelineContent}>
          {loading ? (
            <div className={styles.changeTimelineEmpty}>
              <Spinner size="tiny" />
              <Text>正在加载变更记录...</Text>
            </div>
          ) : transactions.length === 0 ? (
            <div className={styles.changeTimelineEmpty}>暂无 AI 写入事务记录。</div>
          ) : (
            <>
              {groups.length > 0 && (
                <div className={styles.changeTimelineGroupBar}>
                  <Text className={styles.changeTimelineSmallText}>操作组</Text>
                  {groups.slice(0, 4).map((groupId) => (
                    <Button
                      key={groupId}
                      appearance="secondary"
                      size="small"
                      onClick={() => { void onRollbackGroup(groupId); }}
                    >
                      撤回 {groupId.slice(0, 10)}
                    </Button>
                  ))}
                </div>
              )}

              <div className={styles.changeTimelineList}>
                {transactions.map((transaction) => {
                  const canRollback = transaction.status === "committed" && !transaction.rollbackOf;
                  const isPreviewing = previewingTransactionId === transaction.id;
                  return (
                    <div
                      key={transaction.id}
                      className={mergeClasses(
                        styles.changeTimelineItem,
                        transaction.rollbackOf && styles.changeTimelineRollbackItem
                      )}
                    >
                      <div className={styles.changeTimelineItemHeader}>
                        <div className={styles.changeTimelineItemMain}>
                          <Text className={styles.changeTimelineItemTitle}>
                            {operationLabel(transaction)}
                          </Text>
                          <Text className={styles.changeTimelineSmallText}>
                            {formatTime(transaction.committedAt || transaction.createdAt)} · {targetLabel(transaction)}
                          </Text>
                        </div>
                        <Text className={styles.changeTimelineStatus}>
                          {statusLabel(transaction.status)}
                        </Text>
                      </div>
                      <Text className={styles.changeTimelineSmallText}>
                        {transaction.id}
                        {transaction.operationGroupId ? ` · 组 ${transaction.operationGroupId}` : ""}
                      </Text>
                      {transaction.preview?.summary && (
                        <Text className={styles.changeTimelineSummary}>{transaction.preview.summary}</Text>
                      )}
                      {transaction.errorMessage && (
                        <Text className={styles.changeTimelineError}>{transaction.errorMessage}</Text>
                      )}
                      <div className={styles.changeTimelineItemActions}>
                        <Button
                          appearance="secondary"
                          size="small"
                          onClick={() => { void onPreviewRollback(transaction.id); }}
                          disabled={!canRollback || isPreviewing}
                        >
                          {isPreviewing ? "预览中..." : "撤回预览"}
                        </Button>
                        <Button
                          appearance="primary"
                          size="small"
                          icon={<ArrowUndo24Regular />}
                          onClick={() => { void onRollbackTransaction(transaction.id); }}
                          disabled={!canRollback}
                        >
                          撤回
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {selectedPreview && (
                <div className={styles.changeTimelinePreview}>
                  <div className={styles.changeTimelineItemHeader}>
                    <Text className={styles.changeTimelineItemTitle}>撤回预览</Text>
                    <Text
                      className={mergeClasses(
                        styles.changeTimelineStatus,
                        selectedPreview.canRollback ? styles.statusSuccess : styles.statusWarning
                      )}
                    >
                      {selectedPreview.canRollback ? "可撤回" : "已阻断"}
                    </Text>
                  </div>
                  <Text className={styles.changeTimelineSmallText}>
                    {selectedPreview.targetDescription}
                  </Text>
                  {selectedPreview.blockedReason && (
                    <Text className={styles.changeTimelineError}>{selectedPreview.blockedReason}</Text>
                  )}
                  <div className={styles.changeTimelinePreviewGrid}>
                    <div className={styles.changeTimelinePreviewBlock}>
                      <Text className={styles.changeTimelineSmallText}>当前内容</Text>
                      <Text>{selectedPreview.currentText || "（空）"}</Text>
                    </div>
                    <div className={styles.changeTimelinePreviewBlock}>
                      <Text className={styles.changeTimelineSmallText}>将恢复为</Text>
                      <Text>{selectedPreview.restoreText || "（空）"}</Text>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
