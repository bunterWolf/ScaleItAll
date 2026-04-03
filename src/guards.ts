// =============================================================================
// Guard helpers — variable bindings, style bindings, instance checks, constraints
// =============================================================================

export function isBoundToVariable(node: SceneNode, field: string): boolean {
  if (!('boundVariables' in node)) return false;
  const bv = (node as any).boundVariables;
  return bv != null && field in bv && bv[field] != null;
}

export function isBoundToStyle(node: SceneNode, field: string): boolean {
  if (field === 'effects' && 'effectStyleId' in node) {
    return !!(node as BlendMixin).effectStyleId;
  }
  if (field === 'textStyle' && node.type === 'TEXT') {
    return !!(node as TextNode).textStyleId;
  }
  return false;
}

export function isDescendantOfInstance(node: SceneNode): boolean {
  let current: BaseNode | null = node.parent;
  while (current !== null) {
    if (current.type === 'INSTANCE') return true;
    current = (current as SceneNode).parent ?? null;
  }
  return false;
}

/**
 * Returns true if the given field is controlled by a SCALE constraint on this
 * node. Writing to such a field directly would cause double-scaling.
 */
export function hasScaleConstraint(node: SceneNode, field: string): boolean {
  if (!('constraints' in node)) return false;
  const c = (node as ConstraintMixin).constraints;
  if ((field === 'x' || field === 'width')  && c.horizontal === 'SCALE') return true;
  if ((field === 'y' || field === 'height') && c.vertical   === 'SCALE') return true;
  return false;
}
