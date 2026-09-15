'use client';

import Image from 'next/image';
import { createPortal, flushSync } from 'react-dom';
import { FullscreenControl } from './FullscreenControl';
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
import type { CollectionImage } from '../collections';
import { lockBodyScroll } from './bodyScrollLock';
import { useDialogIsolation } from './dialogIsolation';
import { gridButtonLabel, pickGridSrc, pickViewerSrc, shouldPreloadNeighbors } from './curatedGalleryHelpers';
import styles from './CuratedGallery.module.css';

interface CuratedGalleryProps {
	images: readonly CollectionImage[];
	title: string;
}

export function CuratedGallery({ images, title }: CuratedGalleryProps) {
	const [activeIndex, setActiveIndex] = useState<number | null>(null);
	const [failedIds, setFailedIds] = useState<Set<string>>(() => new Set());
	const triggerRef = useRef<HTMLButtonElement | null>(null);
    const transitionRef = useRef<ViewTransition | null>(null);
    useEffect(() => () => transitionRef.current?.skipTransition(), []);

	const openViewer = useCallback((index: number, trigger: HTMLButtonElement) => {
		triggerRef.current = trigger;
        transitionRef.current?.skipTransition();
        const thumbnail = trigger.querySelector('img');
        if (!thumbnail || !document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setActiveIndex(index);
            return;
        }
        thumbnail.style.viewTransitionName = 'photo-focus';
        document.documentElement.dataset.photoTransition = '';
        const transition = document.startViewTransition(() => {
            thumbnail.style.viewTransitionName = '';
            flushSync(() => setActiveIndex(index));
        });
        transitionRef.current = transition;
        void transition.ready.catch(() => {});
        void transition.finished.catch(() => {}).finally(() => {
            thumbnail.style.viewTransitionName = '';
            if (transitionRef.current === transition) {
                delete document.documentElement.dataset.photoTransition;
                transitionRef.current = null;
            }
        });
	}, []);
	const closeViewer = useCallback(async () => {
        transitionRef.current?.skipTransition();
        if (document.fullscreenElement?.hasAttribute('data-curated-viewer')) {
            try { await document.exitFullscreen(); } catch { /* Removing the dialog also exits fullscreen. */ }
        }
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
								aria-label={gridButtonLabel(image, index, images.length)}
								onClick={(event) => openViewer(index, event.currentTarget)}
							>
								<Image
									src={pickGridSrc(image)}
									alt={image.alt}
									width={image.width}
									height={image.height}
									sizes="(max-width: 620px) 100vw, 50vw"
									priority={index === 0}
									loading={index === 0 ? 'eager' : 'lazy'}
									unoptimized
									className={styles.image}
                                    data-route-image={index === 0 && activeIndex === null ? title.toLowerCase() : undefined}
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
			<ViewerPortal
				images={images}
				title={title}
				index={activeIndex ?? 0}
				open={activeIndex !== null}
				onClose={closeViewer}
				onIndexChange={setActiveIndex}
				triggerRef={triggerRef}
				onImageError={markFailed}
			/>
		</section>
	);
}

function ViewerPortal({ open, ...viewerProps }: PhotoViewerProps & { open: boolean }) {
	const [host, setHost] = useState<HTMLElement | null>(null);
	useDialogIsolation(open);
	useEffect(() => {
		setHost(document.getElementById('dialog-host'));
	}, []);
	if (!open) return null;
	if (host) return createPortal(<PhotoViewer {...viewerProps} />, host);
	return <PhotoViewer {...viewerProps} />;
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
	const viewerImageWrapRef = useRef<HTMLDivElement | null>(null);
	const viewerImageRef = useRef<HTMLImageElement | null>(null);
	const [imageFailed, setImageFailed] = useState(false);
	const [zoomLevel, setZoomLevel] = useState(1);
	const [pan, setPan] = useState({ x: 0, y: 0 });
	const zoomRef = useRef(zoomLevel);
	const panRef = useRef(pan);
	const indexRef = useRef(index);
	const touchStartRef = useRef<{ x: number; y: number } | null>(null);
	const touchTrackingRef = useRef(false);
	const panGestureRef = useRef<{ x: number; y: number; pan: { x: number; y: number }; moved: boolean } | null>(null);
	const mousePanRef = useRef<{ x: number; y: number; pan: { x: number; y: number } } | null>(null);
	const pinchStartRef = useRef<{ distance: number; zoom: number } | null>(null);
	const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);
	const lastTouchToggleRef = useRef(0);
	indexRef.current = index;
	zoomRef.current = zoomLevel;
	panRef.current = pan;

	const clampZoom = useCallback((value: number) => Math.min(3, Math.max(1, value)), []);
	const getPanBounds = useCallback((nextZoom: number) => {
		const wrap = viewerImageWrapRef.current;
		const imageElement = viewerImageRef.current;
		if (!wrap || !imageElement) return { x: 0, y: 0 };
		return {
			x: Math.max(0, (imageElement.offsetWidth * nextZoom - wrap.clientWidth) / 2),
			y: Math.max(0, (imageElement.offsetHeight * nextZoom - wrap.clientHeight) / 2),
		};
	}, []);
	const clampPan = useCallback(
		(nextPan: { x: number; y: number }, nextZoom: number) => {
			const bounds = getPanBounds(nextZoom);
			return {
				x: Math.min(bounds.x, Math.max(-bounds.x, nextPan.x)),
				y: Math.min(bounds.y, Math.max(-bounds.y, nextPan.y)),
			};
		},
		[getPanBounds],
	);
	const resetZoom = useCallback(() => {
		setZoomLevel(1);
		setPan({ x: 0, y: 0 });
		panGestureRef.current = null;
		mousePanRef.current = null;
		pinchStartRef.current = null;
		lastTapRef.current = null;
	}, []);
	useEffect(() => {
		window.addEventListener('resize', resetZoom);
		return () => window.removeEventListener('resize', resetZoom);
	}, [resetZoom]);
	const setZoom = useCallback(
		(nextZoom: number) => {
			const clamped = clampZoom(nextZoom);
			setZoomLevel(clamped);
			if (clamped === 1) setPan({ x: 0, y: 0 });
			else setPan((current) => clampPan(current, clamped));
		},
		[clampPan, clampZoom],
	);
	const toggleZoom = useCallback(() => {
		if (zoomRef.current === 1) setZoom(2);
		else resetZoom();
	}, [resetZoom, setZoom]);

	const goTo = useCallback(
		(nextIndex: number) => {
			if (nextIndex < 0 || nextIndex >= images.length) return;
			resetZoom();
			onIndexChange(nextIndex);
		},
		[images.length, onIndexChange, resetZoom],
	);
	const goPrevious = useCallback(() => goTo(indexRef.current - 1), [goTo]);
	const goNext = useCallback(() => goTo(indexRef.current + 1), [goTo]);

	useEffect(() => {
		const unlock = lockBodyScroll();
		const previousFocus = document.activeElement as HTMLElement | null;
		requestAnimationFrame(() => closeRef.current?.focus());
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.ctrlKey || event.metaKey || event.altKey) return;
			if (event.key === 'Escape') {
				if (document.fullscreenElement === dialogRef.current) return;
				event.preventDefault();
				onClose();
			} else if (event.key === '+' || event.key === '=') {
				event.preventDefault();
				setZoom(zoomRef.current + 0.5);
			} else if (event.key === '-') {
				event.preventDefault();
				setZoom(zoomRef.current - 0.5);
			} else if (event.key === '0') {
				event.preventDefault();
				resetZoom();
			} else if (zoomRef.current > 1 && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
				event.preventDefault();
				const x = event.key === 'ArrowLeft' ? 48 : event.key === 'ArrowRight' ? -48 : 0;
				const y = event.key === 'ArrowUp' ? 48 : event.key === 'ArrowDown' ? -48 : 0;
				setPan((current) => clampPan({ x: current.x + x, y: current.y + y }, zoomRef.current));
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
	}, [clampPan, goNext, goPrevious, onClose, resetZoom, setZoom, triggerRef]);

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
		if (event.touches.length === 2) {
			const first = event.touches[0];
			const second = event.touches[1];
			if (!first || !second) return;
			const distance = Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
			pinchStartRef.current = { distance: Math.max(distance, 1), zoom: zoomRef.current };
			touchStartRef.current = null;
			touchTrackingRef.current = false;
			panGestureRef.current = null;
			return;
		}
		if (event.touches.length !== 1) {
			touchStartRef.current = null;
			touchTrackingRef.current = false;
			panGestureRef.current = null;
			return;
		}
		const touch = event.touches[0];
		if (!touch) return;
		if (zoomRef.current > 1) {
			panGestureRef.current = { x: touch.clientX, y: touch.clientY, pan: panRef.current, moved: false };
			touchStartRef.current = null;
			return;
		}
		touchStartRef.current = { x: touch.clientX, y: touch.clientY };
		touchTrackingRef.current = false;
	};
	const handleTouchMove = (event: ReactTouchEvent<HTMLDivElement>) => {
		if (event.touches.length === 2 && pinchStartRef.current) {
			const first = event.touches[0];
			const second = event.touches[1];
			if (!first || !second) return;
			const distance = Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
			const nextZoom = clampZoom(pinchStartRef.current.zoom * (distance / pinchStartRef.current.distance));
			setZoomLevel(nextZoom);
			setPan((current) => (nextZoom === 1 ? { x: 0, y: 0 } : clampPan(current, nextZoom)));
			return;
		}
		if (event.touches.length !== 1) return;
		const panStart = panGestureRef.current;
		const touch = event.touches[0];
		if (panStart && touch) {
			const deltaX = touch.clientX - panStart.x;
			const deltaY = touch.clientY - panStart.y;
			if (Math.abs(deltaX) <= 8 && Math.abs(deltaY) <= 8) return;
			panStart.moved = true;
			setPan(
				clampPan(
					{ x: panStart.pan.x + deltaX, y: panStart.pan.y + deltaY },
					zoomRef.current,
				),
			);
			return;
		}
		const start = touchStartRef.current;
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
		if (event.touches.length > 0) return;
		if (pinchStartRef.current) {
			pinchStartRef.current = null;
			panGestureRef.current = null;
			return;
		}
		if (panGestureRef.current) {
			const panStart = panGestureRef.current;
			const touch = event.changedTouches[0];
			panGestureRef.current = null;
			if (!panStart.moved && touch) {
				const now = Date.now();
				const previousTap = lastTapRef.current;
				if (previousTap && now - previousTap.time < 300 && Math.hypot(touch.clientX - previousTap.x, touch.clientY - previousTap.y) < 24) {
					lastTapRef.current = null;
					lastTouchToggleRef.current = now;
					toggleZoom();
				} else {
					lastTapRef.current = { time: now, x: touch.clientX, y: touch.clientY };
				}
			}
			return;
		}
		const start = touchStartRef.current;
		const touch = event.changedTouches[0];
		touchStartRef.current = null;
		if (!start || !touch) return;
		if (!touchTrackingRef.current) {
			const now = Date.now();
			const previousTap = lastTapRef.current;
			if (previousTap && now - previousTap.time < 300 && Math.hypot(touch.clientX - previousTap.x, touch.clientY - previousTap.y) < 24) {
				lastTapRef.current = null;
				lastTouchToggleRef.current = now;
				toggleZoom();
			} else {
				lastTapRef.current = { time: now, x: touch.clientX, y: touch.clientY };
			}
			return;
		}
		touchTrackingRef.current = false;
		const deltaX = touch.clientX - start.x;
		if (Math.abs(deltaX) < 52) return;
		if (deltaX < 0) goNext();
		else goPrevious();
	};
	const handleTouchCancel = () => {
		touchStartRef.current = null;
		touchTrackingRef.current = false;
		panGestureRef.current = null;
		pinchStartRef.current = null;
	};
	const handleDoubleClick = (event: MouseEvent<HTMLImageElement>) => {
		if (Date.now() - lastTouchToggleRef.current < 500) return;
		event.preventDefault();
		toggleZoom();
	};
	const handleMouseDown = (event: MouseEvent<HTMLImageElement>) => {
		if (event.button !== 0 || zoomRef.current <= 1) return;
		event.preventDefault();
		mousePanRef.current = { x: event.clientX, y: event.clientY, pan: panRef.current };
	};
	const handleMouseMove = (event: MouseEvent<HTMLImageElement>) => {
		const mousePan = mousePanRef.current;
		if (!mousePan) return;
		event.preventDefault();
		setPan(
			clampPan(
				{ x: mousePan.pan.x + event.clientX - mousePan.x, y: mousePan.pan.y + event.clientY - mousePan.y },
				zoomRef.current,
			),
		);
	};
	const handleMouseUp = () => {
		mousePanRef.current = null;
	};
	// A failed image should be recoverable by navigating to another image,
	// while the viewer itself remains open and its controls remain available.
	const image = images[index];
	const imageId = image?.id;
	const previousNeighbor = images[index - 1];
	const nextNeighbor = images[index + 1];
	const previousNeighborSrc = previousNeighbor ? pickViewerSrc(previousNeighbor) : undefined;
	const nextNeighborSrc = nextNeighbor ? pickViewerSrc(nextNeighbor) : undefined;
	useEffect(() => {
		if (image) setImageFailed(false);
	}, [image]);
	useEffect(() => {
		if (!imageId) return;
		resetZoom();
	}, [imageId, resetZoom]);
	useEffect(() => {
		if (typeof navigator === 'undefined') return;
		const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
		if (!shouldPreloadNeighbors(connection?.saveData)) return;
		const neighborSources = [previousNeighborSrc, nextNeighborSrc].filter(
			(source): source is string => Boolean(source),
		);
		neighborSources.forEach((source) => {
			const imageElement = new window.Image();
			imageElement.src = source;
		});
	}, [nextNeighborSrc, previousNeighborSrc]);
	useEffect(() => {
		setPan((current) => clampPan(current, zoomLevel));
	}, [clampPan, zoomLevel]);
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
			aria-describedby="viewer-keyboard-help"
			data-curated-viewer
			tabIndex={-1}
			onClick={handleBackdropClick}
			onKeyDown={trapFocus}
		>
			<p id="viewer-keyboard-help" className="srOnly">
                Use plus and minus to zoom, and zero to reset. Arrow keys move around a zoomed photo.
                At normal size, left and right change photos. Escape closes the viewer.
            </p>
            <div className={styles.viewerContent}>
                <FullscreenControl targetRef={dialogRef} />
				<button
					ref={closeRef}
					type="button"
					className={styles.close}
					onClick={onClose}
					aria-label="Close photograph viewer"
				>
					<span aria-hidden="true">×</span>
				</button>
				<button type="button" className={styles.zoomToggle} onClick={toggleZoom} aria-label={zoomLevel === 1 ? 'Zoom in' : 'Reset zoom'}>
					{zoomLevel === 1 ? 'Zoom in' : 'Reset zoom'}
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
					ref={viewerImageWrapRef}
					className={styles.viewerImageWrap}
					data-photo-zoom={zoomLevel}
					onTouchStart={handleTouchStart}
					onTouchMove={handleTouchMove}
					onTouchEnd={handleTouchEnd}
					onTouchCancel={handleTouchCancel}
				>
					<Image
						ref={viewerImageRef}
						key={image.id}
						src={pickViewerSrc(image)}
						alt={image.alt}
						sizes="min(84vw, 1200px)"
						width={image.width}
						height={image.height}
						unoptimized
						className={styles.viewerImage}
						style={{ viewTransitionName: 'photo-focus', transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoomLevel})` }}
						onDoubleClick={handleDoubleClick}
						onMouseDown={handleMouseDown}
						onMouseMove={handleMouseMove}
						onMouseUp={handleMouseUp}
						onMouseLeave={handleMouseUp}
						draggable={false}
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
