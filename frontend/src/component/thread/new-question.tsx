'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { Select } from '@/component/ui/select'
import { Sheet } from '@/component/ui/sheet'
import { describeError } from '@/lib/api/error'
import { createThread, threadKey } from '@/lib/api/thread'
import { DEFAULT_TOPIC_ID, useTopics } from '@/lib/topic'
import { pendingQuestionKey } from './pending-question'
import { Composer } from './composer'

export function NewQuestion() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const topics = useTopics()
  const preselected = useSearchParams().get('topic')
  const [topicId, setTopicId] = useState(preselected || DEFAULT_TOPIC_ID)
  const [question, setQuestion] = useState('')

  const create = useMutation({
    mutationFn: () => createThread({ topicId }),
    onSuccess: ({ thread }) => {
      // The question travels in sessionStorage, never in the URL: the thread page asks on mount.
      try {
        sessionStorage.setItem(pendingQuestionKey(thread.id), question.trim())
      } catch {
        toast.error("Couldn't start the answer. Open the thread and ask again.")
      }
      void queryClient.invalidateQueries({ queryKey: threadKey.list })
      router.push(`/thread/${encodeURIComponent(thread.id)}`)
    },
    onError: (err) => toast.error(describeError(err))
  })

  const options = topics.data ?? [{ id: DEFAULT_TOPIC_ID, name: 'Other' }]
  // A `?topic=` value the taxonomy does not know falls back to the default.
  const value = options.some((topic) => topic.id === topicId) ? topicId : DEFAULT_TOPIC_ID

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-title">New question</h1>
      <Sheet className="flex flex-col gap-5 p-5 md:p-6">
        <div className="max-w-64">
          <Select label="Topic" value={value} onChange={(event) => setTopicId(event.target.value)}>
            {options.map((topic) => (
              <option key={topic.id} value={topic.id}>
                {topic.name}
              </option>
            ))}
          </Select>
        </div>
        <Composer
          value={question}
          onChange={setQuestion}
          onSubmit={() => create.mutate()}
          submitting={create.isPending || create.isSuccess}
        />
      </Sheet>
    </div>
  )
}
