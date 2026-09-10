import { format } from "date-fns"
import { zhCN } from "date-fns/locale"
import { CalendarIcon, X } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

const DATE_PICKER_START_MONTH = new Date(1900, 0, 1)
const DATE_PICKER_END_MONTH = new Date(2100, 11, 1)

function validDate(value) {
  if (value === undefined || value === null) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function SingleDatePicker({ label, value, referenceValue, placeholder, clearLabel, dayBoundary, onChange }) {
  "use no memo"
  const [open, setOpen] = useState(false)
  const date = validDate(value)
  const initialMonth = date ?? validDate(referenceValue)

  const selectDate = (nextDate) => {
    if (!nextDate) return
    const normalized = new Date(nextDate)
    if (dayBoundary === "start") {
      normalized.setHours(0, 0, 0, 0)
    } else {
      normalized.setHours(23, 59, 59, 999)
    }
    onChange?.(normalized.getTime())
    setOpen(false)
  }

  return (
    <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-2">
      <span className="text-xs text-gray-500">{label}</span>
      <div className="relative min-w-0">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className={cn(
                "h-9 w-full min-w-0 justify-start px-2.5 text-left font-normal",
                date && "pr-9",
                !date && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-1.5 h-4 w-4 shrink-0" />
              <span className="truncate">{date ? format(date, "yyyy/MM/dd") : placeholder}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[320px] max-w-[calc(100vw-2rem)] p-0" align="start">
            <Calendar
              initialFocus
              mode="single"
              defaultMonth={initialMonth}
              selected={date}
              captionLayout="dropdown"
              startMonth={DATE_PICKER_START_MONTH}
              endMonth={DATE_PICKER_END_MONTH}
              locale={zhCN}
              formatters={{
                formatMonthDropdown: (month) => `${month.getMonth() + 1}月`,
                formatYearDropdown: (year) => `${year.getFullYear()}年`,
              }}
              // DayPicker's flex rows have no intrinsic width; keep the seven columns from
              // collapsing to the narrow sidebar trigger.
              classNames={{
                root: "w-full",
                months: "relative flex w-full flex-col gap-4",
                month: "flex w-full flex-col gap-4",
              }}
              onSelect={selectDate}
            />
            <div className="flex justify-end gap-2 border-t p-2">
              {date ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onChange?.(undefined)
                    setOpen(false)
                  }}
                >
                  清空
                </Button>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => selectDate(new Date())}
              >
                今天
              </Button>
            </div>
          </PopoverContent>
        </Popover>
        {date ? (
          <button
            type="button"
            className="absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            title={clearLabel}
            aria-label={clearLabel}
            onClick={() => {
              onChange?.(undefined)
              setOpen(false)
            }}
          >
            <X className="h-4 w-4 opacity-70" />
          </button>
        ) : null}
      </div>
    </div>
  )
}

export function DateFilterPicker({ value, onChange, className }) {
  const from = value?.from
  const to = value?.to

  return (
    <div className={cn("space-y-2", className)}>
      <SingleDatePicker
        label="开始"
        value={from}
        referenceValue={to}
        placeholder="不限开始日期"
        clearLabel="清空开始日期"
        dayBoundary="start"
        onChange={(nextFrom) => onChange?.({ from: nextFrom, to })}
      />
      <SingleDatePicker
        label="结束"
        value={to}
        referenceValue={from}
        placeholder="不限结束日期"
        clearLabel="清空结束日期"
        dayBoundary="end"
        onChange={(nextTo) => onChange?.({ from, to: nextTo })}
      />
    </div>
  )
}
