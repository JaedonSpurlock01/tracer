/**
 * -------------------------------------------------------------------------
 * @file   report-notifications.tsx
 * @brief  Renders the app header notification popover for reports and exports.
 *
 * @description
 *  A header button opens a Popover with the requester's most recent report
 *  and export jobs: each job's kind, Workspace scope, status, a concise
 *  failure reason, and a download link for every completed file, then a
 *  link to Reports for the full history. The button shows how many jobs
 *  are Queued or Generating. Opening the popover refreshes the list, and
 *  the shared jobs provider polls while any job is in progress.
 *
 * @remarks
 *  DESIGN puts export progress and completed downloads here rather than on
 *  a separate page. The popover keeps no read or unread state.
 *
 * @see
 *  components/tracer/report-jobs.tsx
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import Link from "next/link";
import { BellIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/reui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { formatCallTime } from "@/components/tracer/call-format";
import {
  fileLabels,
  jobDisplayStatus,
  jobInProgress,
  jobKindLabel,
  jobScopeLabel,
  statusVariants,
  useReportJobs,
} from "@/components/tracer/report-jobs";

const recentJobCount = 5;

export default function ReportNotifications() {
  const { jobs, checkedAt, failed, refresh } = useReportJobs();
  const [open, setOpen] = useState(false);
  const inProgress = jobs?.filter(jobInProgress).length ?? 0;
  const recent = (jobs ?? []).slice(0, recentJobCount);
  const localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void refresh();
      }}
    >
      <PopoverTrigger render={<Button type="button" variant="ghost" size="sm" aria-label={inProgress ? `Notifications, ${inProgress} in progress` : "Notifications"} />}>
        <BellIcon aria-hidden />
        {inProgress ? (
          <Badge variant="info-light" size="sm" aria-hidden className="tabular-nums">
            {inProgress}
          </Badge>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <PopoverHeader>
          <PopoverTitle>Reports and exports</PopoverTitle>
          <PopoverDescription>Recent jobs you requested.</PopoverDescription>
        </PopoverHeader>
        {failed && jobs === null ? (
          <div className="flex flex-col items-start gap-2">
            <p role="alert" className="text-muted-foreground">Notifications are unavailable.</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
              Retry
            </Button>
          </div>
        ) : jobs !== null && recent.length === 0 ? (
          <p className="text-muted-foreground">Reports and exports you request appear here.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {recent.map((job) => {
              const status = jobDisplayStatus(job, checkedAt);
              const downloads = job.files.filter((file) => file.downloadable && file.href);
              return (
                <li key={job.id} className="flex flex-col gap-1 py-2 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{jobKindLabel(job)}</span>
                    <Badge variant={statusVariants[status]}>{status}</Badge>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{jobScopeLabel(job)}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">{formatCallTime(job.requestedAt, localTimeZone)}</p>
                  {status === "Failed" && job.failureReason ? <p className="text-xs text-muted-foreground">{job.failureReason}</p> : null}
                  {downloads.length ? (
                    <div className="flex flex-wrap gap-1">
                      {downloads.map((file) => (
                        <a key={file.file} className={buttonVariants({ variant: "outline", size: "xs" })} href={file.href ?? undefined} download>
                          Download {fileLabels[file.file]}
                        </a>
                      ))}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <Link href="/reports" prefetch className={buttonVariants({ variant: "ghost", size: "sm" })} onClick={() => setOpen(false)}>
          View Reports
        </Link>
      </PopoverContent>
    </Popover>
  );
}
