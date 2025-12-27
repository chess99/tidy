import { addDays, format } from "date-fns"
import { CalendarIcon, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export function DateRangePicker({ value, onChange, className }) {
  "use no memo"
  const from = value?.from ? new Date(value.from) : undefined
  const to = value?.to ? new Date(value.to) : undefined
  const selected = { from, to }

  return (
    <div className={cn("grid gap-2", className)}>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            id="date"
            variant="outline"
            className={cn(
              "w-full justify-between text-left font-normal",
              !from && !to && "text-muted-foreground"
            )}
          >
            <span className="flex min-w-0 items-center">
              <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
              <span className="truncate">
                {from ? (
                  to ? (
                    <>
                      {format(from, "yyyy-MM-dd")} – {format(to, "yyyy-MM-dd")}
                    </>
                  ) : (
                    format(from, "yyyy-MM-dd")
                  )
                ) : (
                  <span>选择日期范围</span>
                )}
              </span>
            </span>
            {from || to ? (
              <span
                role="button"
                tabIndex={0}
                className="ml-2 inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground"
                title="清空日期筛选"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onChange?.({ from: undefined, to: undefined })
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    e.stopPropagation()
                    onChange?.({ from: undefined, to: undefined })
                  }
                }}
              >
                <X className="h-4 w-4 opacity-70" />
              </span>
            ) : (
              <span className="ml-2 inline-flex h-7 w-7 items-center justify-center opacity-70">
                {/* spacer to keep layout stable */}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[680px] max-w-[calc(100vw-2rem)] p-0" align="start">
          <Calendar
            initialFocus
            mode="range"
            defaultMonth={from}
            selected={selected}
            // Don't change the shared Calendar component styles; only stretch layout for this picker.
            classNames={{
              root: "w-full",
              months: "relative flex w-full flex-col gap-4 md:flex-row md:justify-between",
              month: "flex w-full flex-col gap-4 md:w-1/2",
            }}
            onSelect={(range) => {
              const f = range?.from
                ? new Date(new Date(range.from).setHours(0, 0, 0, 0)).getTime()
                : undefined
              const t = range?.to
                ? new Date(new Date(range.to).setHours(23, 59, 59, 999)).getTime()
                : undefined
              onChange?.({ from: f, to: t })
            }}
            numberOfMonths={2}
          />
          <div className="p-2 border-t flex gap-2 justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChange?.({ from: undefined, to: undefined })}
            >
              清空
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                const now = new Date()
                const f = new Date(now)
                f.setHours(0, 0, 0, 0)
                const t = new Date(now)
                t.setHours(23, 59, 59, 999)
                onChange?.({ from: f.getTime(), to: t.getTime() })
              }}
            >
              今天
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                const now = new Date()
                const f = addDays(now, -6)
                f.setHours(0, 0, 0, 0)
                const t = new Date(now)
                t.setHours(23, 59, 59, 999)
                onChange?.({ from: f.getTime(), to: t.getTime() })
              }}
            >
              最近7天
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}


