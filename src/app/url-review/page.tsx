import UrlReviewPage from '@/features/url-review/components/UrlReviewPage';

export const metadata = {
  title: 'URL Review · Photarium',
  description: 'Scan a page, review discovered media, and export image URLs for Photarium ingestion.',
};

export default function UrlReviewRoute() {
  return <UrlReviewPage />;
}
