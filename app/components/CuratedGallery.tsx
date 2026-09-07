'use client';

import Image from 'next/image';
import {
	type MutableRefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
	type KeyboardEvent as ReactKeyboardEvent,
	type MouseEvent,
	type TouchEvent as ReactTouchEvent,
} from 'react';
import { lockBodyScroll } from './bodyScrollLock';
import type { CollectionImage } from '../collections';
import styles from './CuratedGallery.module.css';

interface CuratedGalleryProps {
	images: readonly CollectionImage[];
	title: string;
}

export function CuratedGallery({ images, title }: CuratedGalleryProps) {
	const [activeIndex, setActiveIndex] = useState<number | null>(null);
	const [failedIds, setFailedIds] = useState<Set<string>>(() => new Set());
	const triggerRef = useRef<HTMLButtonElement | null>(null);

	const openViewer = useCallback((index: number, trigger: HTMLButtonElement) => {
		triggerRef.current = trigger;
		setActiveIndex(index);
	}, []);
	const closeViewer = useCallback(() => {
		setActiveIndex(null);
	}, []);
	const markFailed = useCallback((id: string) => {
		setFailedIds((previous) => {
			if (previous.has(id)) return previous;
			const next = new Set(previous);
			next.add(id);
			return next;
		});
	}, []);

	return (
		<section className={styles.gallery} aria-labelledby="curated-gallery-heading">
			<h2 id="curated-gallery-heading" className={styles.heading}>
				Selected work
			</h2>
			<div className={styles.grid} data-curated-gallery>
				{images.map((image, index) => {
					const failed = failedIds.has(image.id);
					return (
						<figure
							className={`${styles.tile} ${image.width / image.height > 1.2 && index === 2 ? styles.featuredLandscape : ''}`}
							key={image.id}
						>
							<button
								type="button"
								className={styles.imageButton}
								aria-label={`Open photograph ${index + 1} of ${images.length}`}
								onClick={(event) => openViewer(index, event.currentTarget)}
							>
								<Image
									src={image.src}
									alt={image.alt}
									width={image.width}
									height={image.height}
									priority={index === 0}
									loading={index === 0 ? 'eager' : 'lazy'}
									unoptimized
									className={styles.image}
									onError={() => markFailed(image.id)}
								/>
								{failed ? (
									<span className={styles.imageError} role="status">
										Image unavailable
									</span>
								) : null}
							</button>
						</figure>
					);
				})}
			</div>
			{activeIndex !== null ? (
				<PhotoViewer
					images={images}
					title={title}
					index={activeIndex}
					onClose={closeViewer}
					onIndexChange={setActiveIndex}
					triggerRef={triggerRef}
					onImageError={markFailed}
				/>
			) : null}
		</section>
	);
}

interface PhotoViewerProps {
	images: readonly CollectionImage[];
	title: string;
	index: number;
	onClose: () => void;
	onIndexChange: (index: number) => void;
	triggerRef: MutableRefObject<HTMLButtonElement | null>;
	onImageError: (id: string) => void;
}

function PhotoViewer({
	images,
	title,
	index,
	onClose,
	onIndexChange,
	triggerRef,
	onImageError,
}: PhotoViewerProps) {
	const dialogRef = useRef<HTMLDivElement | null>(null);
	const closeRef = useRef<HTMLButtonElement | null>(null);
	const [imageFailed, setImageFailed] = useState(false);
	const indexRef = useRef(index);
	const touchStartRef = useRef<{ x: number; y: number } | null>(null);
	const touchTrackingRef = useRef(false);
	indexRef.current = index;

	const goTo = useCallback(
		(nextIndex: number) => {
			if (nextIndex < 0 || nextIndex >= images.length) return;
			onIndexChange(nextIndex);
		},
		[images.length, onIndexChange],
	);
	const goPrevious = useCallback(() => goTo(indexRef.current - 1), [goTo]);
	const goNext = useCallback(() => goTo(indexRef.current + 1), [goTo]);

	useEffect(() => {
		const unlock = lockBodyScroll();
		const previousFocus = document.activeElement as HTMLElement | null;
		requestAnimationFrame(() => closeRef.current?.focus());
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				onClose();
			} else if (event.key === 'ArrowLeft') {
				event.preventDefault();
				goPrevious();
			} else if (event.key === 'ArrowRight') {
				event.preventDefault();
				goNext();
			}
		};
		document.addEventListener('keydown', handleKeyDown);
		return () => {
			document.removeEventListener('keydown', handleKeyDown);
			unlock();
			const target = triggerRef.current ?? previousFocus;
			requestAnimationFrame(() => target?.focus());
		};
	}, [goNext, goPrevious, onClose, triggerRef]);

	const trapFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		if (event.key !== 'Tab') return;
		const focusable = Array.from(
			event.currentTarget.querySelectorAll<HTMLElement>(
				'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
			),
		);
		if (focusable.length === 0) {
			event.preventDefault();
			closeRef.current?.focus();
			return;
		}
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		if (!first || !last) return;
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	};
	const handleBackdropClick = (event: MouseEvent<HTMLDivElement>) => {
		if (event.target === event.currentTarget) onClose();
	};
	const handleTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
		if (event.touches.length !== 1) {
			touchStartRef.current = null;
			touchTrackingRef.current = false;
			return;
		}
		const touch = event.touches[0];
		if (!touch) return;
		touchStartRef.current = { x: touch.clientX, y: touch.clientY };
		touchTrackingRef.current = false;
	};
	const handleTouchMove = (event: ReactTouchEvent<HTMLDivElement>) => {
		if (event.touches.length !== 1) {
			handleTouchCancel();
			return;
		}
		const start = touchStartRef.current;
		const touch = event.touches[0];
		if (!start || !touch) return;
		const deltaX = touch.clientX - start.x;
		const deltaY = touch.clientY - start.y;
		if (Math.abs(deltaX) <= 8 && Math.abs(deltaY) <= 8) return;
		if (Math.abs(deltaX) <= Math.abs(deltaY)) {
			touchStartRef.current = null;
			return;
		}
		touchTrackingRef.current = true;
	};
	const handleTouchEnd = (event: ReactTouchEvent<HTMLDivElement>) => {
		const start = touchStartRef.current;
		const touch = event.changedTouches[0];
		touchStartRef.current = null;
		if (!start || !touch || !touchTrackingRef.current) return;
		touchTrackingRef.current = false;
		const deltaX = touch.clientX - start.x;
		if (Math.abs(deltaX) < 52) return;
		if (deltaX < 0) goNext();
		else goPrevious();
	};
	const handleTouchCancel = () => {
		touchStartRef.current = null;
		touchTrackingRef.current = false;
	};
	// A failed image should be recoverable by navigating to another image,
	// while the viewer itself remains open and its controls remain available.
	const image = images[index];
	useEffect(() => {
		if (image) setImageFailed(false);
	}, [image]);
	if (!image) return null;
	const hasPrevious = index > 0;
	const hasNext = index < images.length - 1;

	return (
		<div
			ref={dialogRef}
			className={styles.viewer}
			role="dialog"
			aria-modal="true"
			aria-label={`${title} photograph viewer`}
			data-curated-viewer
			tabIndex={-1}
			onClick={handleBackdropClick}
			onKeyDown={trapFocus}
		>
			<div className={styles.viewerContent}>
				<button
					ref={closeRef}
					type="button"
					className={styles.close}
					onClick={onClose}
					aria-label="Close photograph viewer"
				>
					<span aria-hidden="true">×</span>
				</button>
				<button
					type="button"
					className={`${styles.arrow} ${styles.previous}`}
					onClick={goPrevious}
					aria-disabled={!hasPrevious}
					aria-label="Previous photograph"
				>
					<span aria-hidden="true">‹</span>
				</button>
				<div
					className={styles.viewerImageWrap}
					onTouchStart={handleTouchStart}
					onTouchMove={handleTouchMove}
					onTouchEnd={handleTouchEnd}
					onTouchCancel={handleTouchCancel}
				>
					<Image
						key={image.id}
						src={image.src}
						alt={image.alt}
						width={image.width}
						height={image.height}
						unoptimized
						className={styles.viewerImage}
						onError={() => {
							setImageFailed(true);
							onImageError(image.id);
						}}
					/>
					{imageFailed ? (
						<span className={styles.viewerError} role="status">
							Image unavailable
						</span>
					) : null}
					<span className={styles.viewerStatus} role="status">
						{`${index + 1} of ${images.length}`}
					</span>
				</div>
				<button
					type="button"
					className={`${styles.arrow} ${styles.next}`}
					onClick={goNext}
					aria-disabled={!hasNext}
					aria-label="Next photograph"
				>
					<span aria-hidden="true">›</span>
				</button>
			</div>
		</div>
	);
}
