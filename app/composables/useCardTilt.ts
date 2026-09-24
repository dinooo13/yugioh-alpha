import type { CSSProperties } from 'vue'

const MAX_TILT_DEG = 8

/**
 * A card that tilts towards the pointer (ADR 0016: motion is a reward). Up
 * to ±8°, updated once per animation frame, and only on devices with a
 * hovering pointer that don't ask for reduced motion — elsewhere `style`
 * stays empty and the handlers do nothing.
 */
export function useCardTilt() {
  const rotation = ref<{ x: number, y: number } | null>(null)
  let frame = 0

  function enabled(): boolean {
    return import.meta.client
      && window.matchMedia('(hover: hover) and (prefers-reduced-motion: no-preference)').matches
  }

  function onMove(event: PointerEvent) {
    if (event.pointerType !== 'mouse' || !enabled()) {
      return
    }
    const target = event.currentTarget as HTMLElement
    const { clientX, clientY } = event
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      const box = target.getBoundingClientRect()
      const px = (clientX - box.left) / box.width - 0.5
      const py = (clientY - box.top) / box.height - 0.5
      rotation.value = { x: -py * 2 * MAX_TILT_DEG, y: px * 2 * MAX_TILT_DEG }
    })
  }

  function onLeave() {
    cancelAnimationFrame(frame)
    rotation.value = null
  }

  onBeforeUnmount(() => cancelAnimationFrame(frame))

  const style = computed<CSSProperties>(() => rotation.value
    ? { transform: `perspective(900px) rotateX(${rotation.value.x.toFixed(2)}deg) rotateY(${rotation.value.y.toFixed(2)}deg)` }
    : {})

  return { style, onMove, onLeave }
}
