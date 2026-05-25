import type { MaybeRefOrGetter, ModelRef } from 'vue'

import { onScopeDispose, ref, toValue, watch } from 'vue'

export function useWheelAdjust(props: {
  min: number
  max: number
  step: number
  handleWheel: boolean
}, model: ModelRef<number>, hoverTarget: MaybeRefOrGetter<HTMLElement | undefined | null>) {
  if (!props.handleWheel)
    return

  function onWheelInput(ev: WheelEvent) {
    ev.preventDefault()
    if (ev.deltaY === 0)
      return
    if (props.step < 0 || props.min > props.max)
      return console.warn('Invalid props', props, { source: 'useScrollAdjust' })
    const shiftModifier = ev.shiftKey ? 10 : 1
    let valueAfter = model.value
    if (ev.deltaY < 0)
      valueAfter += props.step * shiftModifier
    if (ev.deltaY > 0)
      valueAfter -= props.step * shiftModifier
    model.value = Math.min(Math.max(valueAfter, props.min), props.max)
  }

  const currentHoverTarget = ref(toValue(hoverTarget))
  const hovered = ref(false)
  const onEnter = () => hovered.value = true
  const onLeave = () => hovered.value = false
  const clearListener = () => {
    currentHoverTarget.value?.removeEventListener('wheel', onWheelInput)
    currentHoverTarget.value?.removeEventListener('mouseenter', onEnter)
    currentHoverTarget.value?.removeEventListener('mouseleave', onLeave)
  }

  watch(() => toValue(hoverTarget), (newTarget) => {
    clearListener()
    hovered.value = false
    currentHoverTarget.value = newTarget
    newTarget?.addEventListener('mouseenter', onEnter)
    newTarget?.addEventListener('mouseleave', onLeave)
  }, { immediate: true })

  watch([hovered, currentHoverTarget], ([hovered, target]) => {
    if (hovered) {
      target?.addEventListener('wheel', onWheelInput)
      return
    }
    target?.removeEventListener('wheel', onWheelInput)
  })

  onScopeDispose(clearListener)
  return { clearListener }
}
