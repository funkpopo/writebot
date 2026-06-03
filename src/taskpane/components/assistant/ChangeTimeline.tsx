import * as React from "react";
import { Button, Spinner, Text } from "@fluentui/react-components";
import {
  ChevronDown24Regular,
  ChevronUp24Regular,
  History24Regular,
} from "@fluentui/react-icons";
import type { EditTransaction } from "../../../utils/editTransactionTypes";
import { useStyles } from "./styles";

export interface ChangeTimelineProps {
  open: boolean;
  transactions: EditTransaction[];
  loading: boolean;
  onToggleOpen: (open: boolean) => void;
  onRefresh: () => Promise<void>;
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
    rolling_back: "恢复中",
    rolled_back: "已恢复",
    failed: "失败",
    blocked_target_changed: "已阻断",
    unknown_commit_state: "提交未知",
  };
  return map[status] || status;
}

function operationLabel(transaction: EditTransaction): string {
  if (transaction.rollbackOf) return "恢复记录";
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

function getTransactionRecordContent(transaction: EditTransaction): string {
  const candidates = [
    transaction.operation.content,
    transaction.after?.text,
    transaction.preview?.afterText,
    transaction.before?.text,
    transaction.preview?.beforeText,
  ];
  const content = candidates.find((item) => typeof item === "string" && item.trim().length > 0);
  return content?.trimEnd() || "（无记录内容）";
}

export const ChangeTimeline: React.FC<ChangeTimelineProps> = ({
  open,
  transactions,
  loading,
  onToggleOpen,
  onRefresh,
}) => {
  const styles = useStyles();

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
            <div className={styles.changeTimelineList}>
              {transactions.map((transaction) => (
                <div key={transaction.id} className={styles.changeTimelineItem}>
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
                  {transaction.preview?.summary && (
                    <Text className={styles.changeTimelineSummary}>{transaction.preview.summary}</Text>
                  )}
                  {transaction.errorMessage && (
                    <Text className={styles.changeTimelineError}>{transaction.errorMessage}</Text>
                  )}
                  <Text className={styles.changeTimelineRecordLabel}>记录内容</Text>
                  <pre className={styles.changeTimelineRecordContent}>{getTransactionRecordContent(transaction)}</pre>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
