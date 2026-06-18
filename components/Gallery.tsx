'use client';

import { useEffect, useState } from 'react';
import styles from './Gallery.module.css';
import settings from '@/settings.json';

type GalleryItem = {
  name?: string;
  file: string;
};

/**
 * Gallery - 基于 settings.json 动态渲染
 * - file: 必需，图片路径为 /images/<file>
 * - name: 可选，有则添加标题+遮罩层，无则只显示图片
 * - 点击图片打开灯箱，支持 ESC 关闭、左右箭头切换
 */
export default function Gallery() {
  const items = settings.gallery as GalleryItem[];
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const isOpen = lightboxIndex !== null;
  const currentItem = isOpen ? items[lightboxIndex!] : null;

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
      <div className={styles.autoWrapper} data-slot-gallery>
        {items.map((item, index) => {
          const bgImage = item.name
            ? `linear-gradient(0deg, #000000cc 11.53%, #66666600 32.99%), url(/images/${item.file})`
            : `url(/images/${item.file})`;

          return (
            <div
              key={index}
              className={`${styles.galleryItem} ${item.name ? styles.withName : ''} ${styles.clickable}`}
              style={{ backgroundImage: bgImage }}
              onClick={() => setLightboxIndex(index)}
            >
              {item.name && <p className={styles.itemTitle}>{item.name}</p>}
            </div>
          );
        })}
      </div>
      <div className={styles.autoWrapper2}>
        <p className={styles.scrollRight}>Scroll right</p>
        <img src="/icons/arrow-right.svg" className={styles.arrowRight} alt="Scroll right" />
      </div>

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
