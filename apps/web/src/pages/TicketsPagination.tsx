import { ChevronLeft, ChevronRight } from "lucide-react";
import { FIRST_PAGE, PAGE_SIZE_OPTIONS } from "@ticket/shared";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface TicketsPaginationProps {
  page: number;
  pageSize: number;
  /** Tickets matching the current filters, across all pages. */
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

export function pageCountOf(total: number, pageSize: number): number {
  // Always at least one page, so an empty result still reads "Page 1 of 1"
  // rather than "of 0".
  return Math.max(1, Math.ceil(total / pageSize));
}

export function TicketsPagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: TicketsPaginationProps) {
  const pageCount = pageCountOf(total, pageSize);
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-4 pt-4 text-sm"
    >
      <p className="text-muted-foreground">
        {first}–{last} of {total}
      </p>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Label htmlFor="ticket-page-size">Per page</Label>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => onPageSizeChange(Number(value))}
          >
            <SelectTrigger id="ticket-page-size" size="sm" className="w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <span aria-live="polite" className="text-muted-foreground">
            Page {page} of {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            aria-label="Previous page"
            disabled={page <= FIRST_PAGE}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft />
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label="Next page"
            disabled={page >= pageCount}
            onClick={() => onPageChange(page + 1)}
          >
            Next
            <ChevronRight />
          </Button>
        </div>
      </div>
    </nav>
  );
}
