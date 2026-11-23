// Collapse strongly connected components before assigning longest-path columns.
// This preserves branches after a loop in both quest flows and imported recipes.
export function graphTiers(
  ids: string[],
  edges: { from: string; to: string }[],
) {
  const outgoing = new Map(ids.map((id) => [id, [] as string[]]))
  const incoming = new Map(ids.map((id) => [id, [] as string[]]))
  for (const { from, to } of edges)
    if (outgoing.has(from) && incoming.has(to)) {
      outgoing.get(from)!.push(to)
      incoming.get(to)!.push(from)
    }
  const visited = new Set<string>(),
    order: string[] = []
  for (const root of ids) {
    if (visited.has(root)) continue
    const stack = [{ id: root, index: 0 }]
    visited.add(root)
    while (stack.length) {
      const top = stack[stack.length - 1],
        children = outgoing.get(top.id)!
      if (top.index === children.length) {
        order.push(top.id)
        stack.pop()
        continue
      }
      const child = children[top.index++]
      if (!visited.has(child)) {
        visited.add(child)
        stack.push({ id: child, index: 0 })
      }
    }
  }
  const component = new Map<string, number>(),
    depth: number[] = []
  for (const root of order.reverse()) {
    if (component.has(root)) continue
    const group = depth.length,
      stack = [root]
    depth.push(0)
    component.set(root, group)
    while (stack.length)
      for (const parent of incoming.get(stack.pop()!)!) {
        if (!component.has(parent)) {
          component.set(parent, group)
          stack.push(parent)
        }
      }
  }
  // Components are numbered in topological order, including interleaved DFS branches.
  const exits = depth.map(() => new Set<number>())
  for (const { from, to } of edges) {
    const a = component.get(from),
      b = component.get(to)
    if (a !== undefined && b !== undefined && a !== b) exits[a].add(b)
  }
  exits.forEach((children, a) =>
    children.forEach((b) => (depth[b] = Math.max(depth[b], depth[a] + 1))),
  )
  return new Map(ids.map((id) => [id, depth[component.get(id)!]]))
}
