import { useEffect, useRef, useState } from 'react'

export function useAnimatedCounter(target: number, duration = 800): number {
  const [value, setValue] = useState(0)
  const startRef = useRef(0)
  const startTimeRef = useRef<number | null>(null)

  useEffect(() => {
    startRef.current = value
    startTimeRef.current = null

    let rafId: number

    const animate = (timestamp: number) => {
      if (startTimeRef.current === null) {
        startTimeRef.current = timestamp
      }

      const elapsed = timestamp - startTimeRef.current
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3) // ease-out cubic

      setValue(startRef.current + (target - startRef.current) * eased)

      if (progress < 1) {
        rafId = requestAnimationFrame(animate)
      }
    }

    rafId = requestAnimationFrame(animate)

    return () => cancelAnimationFrame(rafId)
  }, [target, duration])

  return value
}
