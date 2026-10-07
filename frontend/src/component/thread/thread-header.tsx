'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/component/ui/button'
import { Select } from '@/component/ui/select'
import { describeError } from '@/lib/api/error'
import { deleteThread, threadKey, updateThread, type Thread } from '@/lib/api/thread'
import { DeleteIcon, RenameIcon } from '@/lib/icon'
import { useTopics } from '@/lib/topic'

const MAX_TITLE = 120

function Title({ thread }: { thread: Thread }) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<string>()
  // Escape unmounts the input, which can still fire a blur: this keeps that from saving.
  const cancelled = useRef(false)
  const editing = draft !== undefined
  // Stable, so typing does not re-run it and re-select the text.
  const focusField = useCallback((el: HTMLInputElement | null) => el?.select(), [])

  const rename = useMutation({
    mutationFn: (title: string) => updateThread(thread.id, { title }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: threadKey.all }),
    onError: (err) => toast.error(describeError(err))
  })

  function save() {
    if (cancelled.current || draft === undefined) return
    const title = draft.trim()
    setDraft(undefined)
    if (title && title !== thread.title) rename.mutate(title)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      save()
    } else if (event.key === 'Escape') {
      cancelled.current = true
      setDraft(undefined)
    }
  }

  if (editing) {
    return (
      <h1 className="min-w-0 flex-1">
        <input
          ref={focusField}
          aria-label="Thread title"
          value={draft}
          maxLength={MAX_TITLE}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={save}
          className="h-11 w-full rounded-md border border-ink bg-sheet px-3 text-title font-extrabold tracking-tight text-ink"
        />
      </h1>
    )
  }

  // Optimistic: show the new title while the save is in flight.
  const shown = rename.isPending ? rename.variables : thread.title
  return (
    <h1 className="min-w-0 flex-1 text-title">
      <button
        type="button"
        onClick={() => {
          cancelled.current = false
          setDraft(thread.title)
        }}
        aria-label={`Rename thread: ${shown}`}
        className="group flex max-w-full items-center gap-2 rounded-md text-left hover:bg-ink/5"
      >
        <span className="min-w-0 break-words">{shown}</span>
        <RenameIcon
          aria-hidden="true"
          className="size-4 shrink-0 text-ink-muted opacity-50 group-hover:opacity-100 group-focus-visible:opacity-100"
        />
      </button>
    </h1>
  )
}

export const ThreadHeader = memo(function ThreadHeader({ thread }: { thread: Thread }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const topics = useTopics()
  const [confirming, setConfirming] = useState(false)
  const deleteButton = useRef<HTMLButtonElement>(null)
  const wasConfirming = useRef(false)
  // Focus follows the swap: onto the safe choice when asking, back onto Delete when dismissed.
  const focusCancel = useCallback((el: HTMLButtonElement | null) => el?.focus(), [])
  useEffect(() => {
    if (!confirming && wasConfirming.current) deleteButton.current?.focus()
    wasConfirming.current = confirming
  }, [confirming])

  const changeTopic = useMutation({
    mutationFn: (topicId: string) => updateThread(thread.id, { topicId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: threadKey.all }),
    onError: (err) => toast.error(describeError(err))
  })
  const remove = useMutation({
    mutationFn: () => deleteThread(thread.id),
    onSuccess: () => {
      // Leave first: touching the still-mounted detail query would flash "doesn't exist".
      router.replace('/thread')
      void queryClient.invalidateQueries({ queryKey: threadKey.list })
      toast('Thread deleted')
    },
    onError: (err) => {
      setConfirming(false)
      toast.error(describeError(err))
    }
  })

  const topicId = changeTopic.isPending ? changeTopic.variables : thread.topicId

  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <Title thread={thread} />
      </div>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="w-48">
          <Select
            label="Topic"
            value={topicId}
            disabled={!topics.data}
            onChange={(event) => changeTopic.mutate(event.target.value)}
          >
            {(topics.data ?? [{ id: thread.topicId, name: '…' }]).map((topic) => (
              <option key={topic.id} value={topic.id}>
                {topic.name}
              </option>
            ))}
          </Select>
        </div>
        {confirming ? (
          <div
            role="group"
            aria-label="Delete this thread?"
            className="flex flex-wrap items-center gap-2"
          >
            <p className="font-semibold">Delete this thread?</p>
            <Button
              variant="danger"
              aria-label="Confirm delete"
              onClick={() => remove.mutate()}
              loading={remove.isPending}
            >
              Delete
            </Button>
            <Button variant="secondary" ref={focusCancel} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            ref={deleteButton}
            variant="ghost"
            className="text-wrong hover:bg-wrong/10"
            onClick={() => setConfirming(true)}
          >
            <DeleteIcon aria-hidden="true" className="size-4" />
            Delete
          </Button>
        )}
      </div>
    </header>
  )
})
