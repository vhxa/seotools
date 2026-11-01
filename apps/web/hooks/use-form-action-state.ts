'use client'

import { startTransition, useActionState, type FormEvent } from 'react'

/**
 * `useActionState` for a form that keeps what it shows after a submit. With `<form action>` React
 * resets the form once the action ends, and a reset unchecks the checkbox inside a switch while it
 * still looks on: the next click on it does nothing, and the next submit sends "off". Submitting
 * through `onSubmit` runs the same action without the reset.
 */
export function useFormActionState<State>(
  action: (state: Awaited<State>, formData: FormData) => State | Promise<State>,
  initialState: Awaited<State>,
) {
  const [state, dispatch, pending] = useActionState(action, initialState)
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    startTransition(() => dispatch(formData))
  }
  return [state, onSubmit, pending] as const
}
