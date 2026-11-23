// Stands in for maplibre-gl in the Node bundles (build.mjs): the protocol
// code registers handlers with it, which Node has no use for.
export const addProtocol = () => { }
export const removeProtocol = () => { }
export default { addProtocol, removeProtocol }
