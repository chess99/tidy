async function handlePlaceholder(ctx) {
  const type = String(ctx.job?.type || '');
  return {
    ok: false,
    message: `${type} is not implemented yet`,
  };
}

module.exports = { handlePlaceholder };


