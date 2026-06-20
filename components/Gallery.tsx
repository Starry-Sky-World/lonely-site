'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import gsap from 'gsap';
import styles from './Gallery.module.css';
import settings from '@/settings.json';

type GalleryItem = {
  name?: string;
  file: string;
};

/**
 * 单个 Gallery 卡片
 * - 独立跟踪图片加载状态，未加载完成时显示骨架屏
 * - hover 时放大图片（容器不变，overflow 裁剪）
 */
function GalleryCard({
  item,
  index,
  onClick,
}: {
  item: GalleryItem;
  index: number;
  onClick: () => void;
}) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div
      data-gallery-card
      className={`${styles.galleryItem} ${item.name ? styles.withName : ''} ${styles.clickable}`}
      onClick={onClick}
    >
      {/* 骨架屏：图片未加载完成时显示 */}
      {!loaded && <div className={styles.skeleton} />}

      {/* 图片：加载完成后才显示 */}
      <img
        className={`${styles.cardImg} ${loaded ? styles.cardImgLoaded : ''}`}
        src={`/images/${item.file}`}
        alt={item.name || ''}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
      />

      {/* 有标题时的渐变遮罩 + 标题 */}
      {item.name && loaded && (
        <>
          <div className={styles.overlay} />
          <p className={styles.itemTitle}>{item.name}</p>
        </>
      )}
    </div>
  );
}

/**
 * Gallery - 基于 settings.json 动态渲染
 * - file: 必需，图片路径为 /images/<file>
 * - name: 可选，有则添加标题+遮罩层，无则只显示图片
 * - 点击图片打开灯箱，支持 ESC 关闭、左右箭头切换
 */
export default function Gallery({ limit }: { limit?: number }) {
  const allItems = settings.gallery as GalleryItem[];
  const items = limit ? allItems.slice(0, limit) : allItems;
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hoverCardRef = useRef<HTMLElement | null>(null);
  const galleryLinkRef = useRef<HTMLAnchorElement>(null);

  const isOpen = lightboxIndex !== null;
  const currentItem = isOpen ? items[lightboxIndex!] : null;

  // 悬停跟踪：用 mouseover/mouseout 事件委托（低频，只在进入/离开元素时触发）
  // 经过卡片间 gap 时保持上一张卡片状态，避免 hover 频繁切换造成卡顿
  const handleMouseOver = useCallback((e: React.MouseEvent) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-gallery-card]');
    if (!target || target === hoverCardRef.current) return;
    if (hoverCardRef.current) hoverCardRef.current.classList.remove(styles.hovering);
    target.classList.add(styles.hovering);
    hoverCardRef.current = target;
  }, []);

  const handleMouseOut = useCallback((e: React.MouseEvent) => {
    // relatedTarget 仍在某卡片内 → 交给 mouseover 处理
    const related = e.relatedTarget as HTMLElement | null;
    if (related && related.closest('[data-gallery-card]')) return;
    // 离开容器或进入 gap 区域 → 清除
    if (hoverCardRef.current) {
      hoverCardRef.current.classList.remove(styles.hovering);
      hoverCardRef.current = null;
    }
  }, []);

  // 横向滚动惯性：鼠标滚轮（垂直）转为横向滚动 + rAF 缓动减速
  // 触摸板横向滚动（deltaX）保留原生惯性
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    let target = el.scrollLeft;
    let current = el.scrollLeft;
    let rafId = 0;

    const animate = () => {
      current += (target - current) * 0.12;
      el.scrollLeft = current;
      if (Math.abs(target - current) > 0.5) {
        rafId = requestAnimationFrame(animate);
      } else {
        current = target;
        el.scrollLeft = target;
        rafId = 0;
      }
    };

    const onWheel = (e: WheelEvent) => {
      // 触摸板横向滚动走原生（已有惯性）
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      // 从当前位置开始累积目标
      if (!rafId) {
        current = el.scrollLeft;
        target = el.scrollLeft;
      }
      target += e.deltaY;
      const max = el.scrollWidth - el.clientWidth;
      target = Math.max(0, Math.min(max, target));
      if (!rafId) {
        rafId = requestAnimationFrame(animate);
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      cancelAnimationFrame(rafId);
    };
  }, []);

  // "Go to gallery" 下划线 + 箭头 hover 动画
  const handleLinkEnter = useCallback(() => {
    const el = galleryLinkRef.current;
    if (!el) return;
    const underline = el.querySelector(`.${styles.linkUnderline}`) as HTMLElement | null;
    const arrow = el.querySelector(`.${styles.arrowRight}`) as HTMLElement | null;
    if (underline) gsap.to(underline, { scaleX: 1, duration: 0.4, ease: 'power2.out' });
    if (arrow) gsap.to(arrow, { x: 8, duration: 0.4, ease: 'power2.out' });
  }, []);

  const handleLinkLeave = useCallback(() => {
    const el = galleryLinkRef.current;
    if (!el) return;
    const underline = el.querySelector(`.${styles.linkUnderline}`) as HTMLElement | null;
    const arrow = el.querySelector(`.${styles.arrowRight}`) as HTMLElement | null;
    if (underline) gsap.to(underline, { scaleX: 0, duration: 0.3, ease: 'power2.in', transformOrigin: 'right center' });
    if (arrow) gsap.to(arrow, { x: 0, duration: 0.3, ease: 'power2.in' });
  }, []);

  // 键盘事件：ESC 关闭，左右箭头切换
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxIndex(null);
      if (e.key === 'ArrowLeft' && items.length > 1) {
        setLightboxIndex((prev) => (prev === null ? null : (prev - 1 + items.length) % items.length));
      }
      if (e.key === 'ArrowRight' && items.length > 1) {
        setLightboxIndex((prev) => (prev === null ? null : (prev + 1) % items.length));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, items.length]);

  // 灯箱打开时禁止背景滚动
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [isOpen]);

  const goToPrev = () => setLightboxIndex((prev) => (prev === null ? null : (prev - 1 + items.length) % items.length));
  const goToNext = () => setLightboxIndex((prev) => (prev === null ? null : (prev + 1) % items.length));

  return (
    <div className={styles.gallery2}>
      <p className={styles.gallery}>Gallery</p>
      <div ref={scrollRef} className={styles.autoWrapper} data-slot-gallery
        onMouseOver={handleMouseOver} onMouseOut={handleMouseOut}>
        {items.map((item, index) => (
          <GalleryCard
            key={index}
            item={item}
            index={index}
            onClick={() => setLightboxIndex(index)}
          />
        ))}
      </div>
      {limit && (
        <div className={styles.autoWrapper2}>
          <Link ref={galleryLinkRef} href="/gallery" className={styles.galleryLink}
            onMouseEnter={handleLinkEnter} onMouseLeave={handleLinkLeave}>
            <span className={styles.galleryLinkText}>
              Go to gallery
              <span className={styles.linkUnderline} />
            </span>
            <img src="/icons/arrow-right.svg" className={styles.arrowRight} alt="" loading="lazy" />
          </Link>
        </div>
      )}

      {/* 灯箱 */}
      {isOpen && currentItem && (
        <div className={styles.lightbox} data-slot-lightbox onClick={() => setLightboxIndex(null)}>
          <button
            className={styles.lightboxClose}
            onClick={(e) => { e.stopPropagation(); setLightboxIndex(null); }}
            aria-label="关闭"
          >
            ×
          </button>

          {items.length > 1 && (
            <>
              <button
                className={`${styles.lightboxNav} ${styles.lightboxPrev}`}
                onClick={(e) => { e.stopPropagation(); goToPrev(); }}
                aria-label="上一张"
              >
                ‹
              </button>
              <button
                className={`${styles.lightboxNav} ${styles.lightboxNext}`}
                onClick={(e) => { e.stopPropagation(); goToNext(); }}
                aria-label="下一张"
              >
                ›
              </button>
            </>
          )}

          <div className={styles.lightboxContent} onClick={(e) => e.stopPropagation()}>
            <img
              key={lightboxIndex}
              src={`/images/${currentItem.file}`}
              alt={currentItem.name || ''}
              className={styles.lightboxImage}
            />
            {currentItem.name && <p className={styles.lightboxTitle}>{currentItem.name}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
