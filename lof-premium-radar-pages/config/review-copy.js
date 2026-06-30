const REVIEW_COPY_MODE = true;

function reviewCopy(reviewText, normalText) {
  return REVIEW_COPY_MODE ? reviewText : normalText;
}

module.exports = { REVIEW_COPY_MODE, reviewCopy };
