const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'Xenova/all-mpnet-base-v2';

let embedderPromise = null;

function getEmbedder() {
    if (!embedderPromise) {
        embedderPromise = import('@xenova/transformers').then(({ pipeline }) =>
            pipeline('feature-extraction', EMBEDDING_MODEL)
        );
    }
    return embedderPromise;
}

async function embedText(text) {
    const embedder = await getEmbedder();
    const output = await embedder(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
}

module.exports = { embedText, EMBEDDING_MODEL };
